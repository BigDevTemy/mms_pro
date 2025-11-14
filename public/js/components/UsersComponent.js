/**
 * UsersComponent - User Management dashboard
 * - Dynamic stats: Total Users, Active Users, Total Roles, Total Permissions
 * - Company selector (for superadmin); scoped stats/list by company
 * - Users table with search and pagination
 * - Add User modal (email, first/last name, password, role, company)
 */
class UMUsersComponent {
  constructor(container) {
    this.container = container

    // State
    this.loading = false
    this.error = null

    this.stats = {
      totalUsers: 0,
      activeUsers: 0,
      totalRoles: 0,
      totalPermissions: 0,
    }
    this.roles = []
    this.permissions = [] // optional list, currently not displayed in table
    this.users = []
    this.limit = 10
    this.offset = 0
    this.total = 0 // backend doesn't return total; we can infer by page length
    this.searchQ = ''
    this.modalOpen = false
    this.editingUser = null // for edit mode
    this.searchInput = null // will hold the permanent input
    this.clearBtn = null // will hold the permanent clear button

    // Company scope
    this.companyId = null
    this.companies = []

    // auth context
    this._curUser = undefined

    this.init()
  }

  // ---------- Helpers ----------
  apiBase() {
    return window.API_BASE || '../backend/api'
  }
  async getJson(path) {
    return window.getJson(path)
  }
  async postJson(path, body) {
    return window.postJson(path, body)
  }
  async putJson(path, body) {
    return window.putJson(path, body)
  }
  async deleteJson(path) {
    return window.deleteJson(path)
  }
  currentUser() {
    if (this._curUser !== undefined) return this._curUser
    try {
      const t = localStorage.getItem('token') || ''
      if (!t) {
        this._curUser = null
        return null
      }
      const parts = t.split('.')
      if (parts.length < 2) {
        this._curUser = null
        return null
      }
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
      const json = decodeURIComponent(
        atob(b64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      )
      const payload = JSON.parse(json)
      this._curUser = payload
      return this._curUser
    } catch {
      this._curUser = null
      return null
    }
  }
  isSuperadmin() {
    const u = this.currentUser()
    const roles = (u && u.roles) || []
    return roles.some(
      (r) => r && r.name === 'superadmin' && r.scope === 'global'
    )
  }

  // ---------- Lifecycle ----------
  async init() {
    this.renderShell()
    this._createSearchControls()
    await this.bootstrap()
    this.render()
  }

  async bootstrap() {
    try {
      this.loading = true
      const sup = this.isSuperadmin()
      if (sup) {
        // Fetch companies to scope view
        try {
          const res = await this.getJson('/companies')
          this.companies = Array.isArray(res?.items)
            ? res.items
            : Array.isArray(res)
            ? res
            : []
        } catch {
          this.companies = []
        }
        // For superadmin, start with all users (companyId = null)
        this.companyId = null
      } else {
        // For non-superadmin, check if they have user.manage permission
        const u = this.currentUser()
        this.companyId = (u && u.company_id) || null
        // If no companyId, they might not have access, but let the API handle it
      }
      await Promise.all([
        this.fetchRoles(),
        this.fetchStats(),
        this.fetchUsers(),
      ])
    } catch (e) {
      this.error = e?.error || 'Failed to load user data'
    } finally {
      this.loading = false
    }
  }

  // ---------- API ----------
  buildQuery(params) {
    const usp = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') usp.set(k, String(v))
    })
    const qs = usp.toString()
    return qs ? `?${qs}` : ''
  }

  async fetchStats() {
    try {
      const qs = this.buildQuery({ companyId: this.companyId ?? '' })
      const res = await this.getJson(`/admin/stats${qs}`)
      this.stats = {
        totalUsers: res?.totalUsers || 0,
        activeUsers: res?.activeUsers || 0,
        totalRoles: res?.totalRoles || 0,
        totalPermissions: res?.totalPermissions || 0,
      }
    } catch {
      this.stats = {
        totalUsers: 0,
        activeUsers: 0,
        totalRoles: 0,
        totalPermissions: 0,
      }
    }
  }

  async fetchRoles() {
    try {
      const res = await this.getJson('/admin/roles')
      this.roles = Array.isArray(res?.items) ? res.items : []
    } catch {
      this.roles = []
    }
    try {
      const res2 = await this.getJson('/admin/permissions')
      this.permissions = Array.isArray(res2?.items) ? res2.items : []
    } catch {
      this.permissions = []
    }
  }

  async fetchUsers() {
    try {
      const qs = this.buildQuery({
        companyId: this.companyId ?? '',
        q: this.searchQ || '',
        limit: this.limit,
        offset: this.offset,
      })
      const res = await this.getJson(`/admin/users${qs}`)
      this.users = Array.isArray(res?.items) ? res.items : []
      // backend returns limit and offset only; infer total from page length and previous offset
      this.total =
        this.offset +
        this.users.length +
        (this.users.length === this.limit ? this.limit : 0)
    } catch (e) {
      this.users = []
    }
  }

  // ---------- Actions ----------
  async reloadAll() {
    this.loading = true
    this.renderHeader()
    try {
      await Promise.all([this.fetchStats(), this.fetchUsers()])
    } finally {
      this.loading = false
      this.renderHeader()
      this.renderBody()
    }
  }

  openModal(user = null) {
    this.modalOpen = true
    this.editingUser = user
    this.renderModal()
  }
  closeModal() {
    this.modalOpen = false
    this.editingUser = null
    this.renderModal()
  }

  async createUserFromModal() {
    const token = localStorage.getItem('token') || ''
    if (!token) {
      window.showToast('Login required', false)
      return
    }
    const form = this.container.querySelector('#um-adduser-form')
    if (!form) return
    const email = form.querySelector('[name="email"]').value.trim()
    const password = form.querySelector('[name="password"]').value
    const firstName = form.querySelector('[name="firstName"]').value.trim()
    const lastName = form.querySelector('[name="lastName"]').value.trim()
    const role = form.querySelector('[name="role"]').value
    const companyIdStr = form.querySelector('[name="companyId"]')
      ? form.querySelector('[name="companyId"]').value
      : ''
    const companyId =
      companyIdStr !== '' ? parseInt(companyIdStr, 10) : this.companyId || null

    if (!email || !role) {
      window.showToast('Please fill email, role', false)
      return
    }
    if (!this.editingUser && !password) {
      window.showToast('Password is required for new users', false)
      return
    }
    const payload = { email, role }
    if (password) payload.password = password
    if (firstName) payload.firstName = firstName
    if (lastName) payload.lastName = lastName
    if (companyId !== null && !isNaN(companyId)) payload.companyId = companyId

    try {
      if (this.editingUser) {
        // Update existing user
        await this.putJson(`/admin/users/${this.editingUser.id}`, payload)
        window.showToast('User updated')
      } else {
        // Create new user
        await this.postJson('/admin/users', payload)
        window.showToast('User created')
      }
      this.closeModal()
      await this.reloadAll()
    } catch (e) {
      window.showToast(e?.error || 'Operation failed', false)
    }
  }

  async confirmDelete(user) {
    if (
      confirm(
        `Are you sure you want to delete user "${
          user.fullName || user.email
        }"? This action cannot be undone.`
      )
    ) {
      try {
        await this.deleteJson(`/admin/users/${user.id}`)
        window.showToast('User deleted')
        await this.reloadAll()
      } catch (e) {
        window.showToast(e?.error || 'Delete failed', false)
      }
    }
  }

  downloadSampleCSV() {
    const headers = [
      'email',
      'firstName',
      'lastName',
      'password',
      'role',
      'companyName',
    ]
    const sampleData = [
      [
        'john.doe@example.com',
        'John',
        'Doe',
        'password123',
        'user',
        'Company A',
      ],
      [
        'jane.smith@example.com',
        'Jane',
        'Smith',
        'password456',
        'admin',
        'Company B',
      ],
    ]
    const csvContent = [headers, ...sampleData]
      .map((row) => row.map((field) => `"${field}"`).join(','))
      .join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', 'users_sample.csv')
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  async handleBulkUpload(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (e) => {
      const csv = e.target.result
      const lines = csv.split('\n').filter((line) => line.trim())
      if (lines.length < 2) {
        window.showToast(
          'CSV must have at least a header and one data row',
          false
        )
        return
      }
      const headers = lines[0].split(',').map((h) => h.replace(/"/g, '').trim())
      const expectedHeaders = [
        'email',
        'firstname',
        'lastname',
        'password',
        'role',
        'companyname',
      ]
      const normalizedHeaders = headers.map((h) =>
        h.toLowerCase().replace(/\s/g, '')
      )
      if (!expectedHeaders.every((h) => normalizedHeaders.includes(h))) {
        window.showToast(
          'CSV headers must include: email, firstName, lastName, password, role, companyName',
          false
        )
        return
      }
      const users = []
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i]
          .split(',')
          .map((v) => v.replace(/"/g, '').trim())
        if (values.length !== headers.length) continue
        const user = {}
        headers.forEach((h, idx) => {
          const key = h.toLowerCase().replace(/\s/g, '')
          user[key] = values[idx]
        })
        users.push(user)
      }
      try {
        const response = await this.postJson('/admin/users/bulk', { users })
        window.showToast(
          `Bulk upload completed. Created: ${response.created}, Errors: ${response.errors.length}`
        )
        await this.reloadAll()
      } catch (e) {
        window.showToast(e?.error || 'Bulk upload failed', false)
      }
    }
    reader.readAsText(file)
  }

  // ---------- Rendering ----------
  renderShell() {
    this.container.innerHTML = `
      <div class="ms-card">
        <div class="hd">User Management</div>
        <div class="bd">
          <div id="um-header"></div>
          <div id="um-stats"></div>
          <div id="um-table"></div>
          <div id="um-modal"></div>
        </div>
      </div>
    `
    const style = document.createElement('style')
    style.textContent = `
      .um-row { display:flex; align-items:center; gap:10px; flex-wrap: wrap; margin-bottom: 10px; }
      .um-spacer { flex: 1; }
      .um-grid { display:grid; grid-template-columns: repeat(4, minmax(200px,1fr)); gap:12px; margin-bottom: 14px; }
      .um-stat { border:1px solid #e5e7eb; border-radius:10px; padding:12px; background:#fff; }
      .um-stat .h { font-size:12px; color:#6b7280; }
      .um-stat .v { font-size:20px; font-weight:700; color:#111827; margin-top:4px; }
      .um-table table { width:100%; border-collapse:collapse; }
      .um-table th, .um-table td { text-align:left; border-bottom:1px solid #e5e7eb; padding:6px 8px; vertical-align:top; }
      .um-table th { background:#f9fafb; }
      .um-pager { display:flex; gap:8px; justify-content:flex-end; margin-top:10px; }
      .um-modal { position:fixed; inset:0; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,0.4); }
      .um-modal.open { display:flex; }
      .um-modal .panel { width:520px; background:#fff; border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,0.15); overflow:hidden; }
      .um-modal .panel .hd { padding:12px 14px; font-weight:700; border-bottom:1px solid #eee; }
      .um-modal .panel .bd { padding:14px; }
      .um-form .row { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
      .um-form .row label { width:120px; color:#6b7280; font-size:12px; }
      .ms-select, .ms-input, .ms-btn { height:auto; }
    `
    this.container.appendChild(style)
  }

  render() {
    this.renderHeader()
    this.renderStats()
    this.renderBody()
    this.renderModal()
  }

  renderHeader() {
    const mount = this.container.querySelector('#um-header')
    if (!mount) return
    const wrap = document.createElement('div')
    wrap.className = 'um-row'

    // Company control for superadmin
    if (this.isSuperadmin()) {
      const sel = document.createElement('select')
      sel.className = 'ms-select'
      sel.appendChild(new Option('All Companies', ''))
      for (const co of this.companies) {
        sel.appendChild(new Option(co.name, String(co.id)))
      }
      sel.value = this.companyId != null ? String(this.companyId) : ''
      sel.addEventListener('change', async (e) => {
        const v = e.target.value
        this.companyId = v === '' ? null : parseInt(v, 10)
        await this.reloadAll()
      })
      wrap.appendChild(this.h('label', 'small muted', 'Company'))
      wrap.appendChild(sel)
    }

    // Note: Table-level search is now in renderBody() for top-right placement

    // Reload
    const btnReload = this.button(
      this.loading ? 'Loading...' : 'Reload',
      async () => {
        await this.reloadAll()
      }
    )
    wrap.appendChild(btnReload)

    // Download sample CSV
    const btnDownload = this.button(
      'Download Sample CSV',
      () => this.downloadSampleCSV(),
      'primary'
    )
    wrap.appendChild(btnDownload)

    // Bulk upload
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = '.csv'
    fileInput.style.display = 'none'
    fileInput.addEventListener('change', (e) =>
      this.handleBulkUpload(e.target.files[0])
    )
    const btnUpload = this.button(
      'Bulk Upload CSV',
      () => fileInput.click(),
      'success'
    )
    wrap.appendChild(btnUpload)
    wrap.appendChild(fileInput)

    // Add user
    const btnAdd = this.button('Add User', () => this.openModal(), 'success')
    btnAdd.disabled = !!this.loading
    wrap.appendChild(btnAdd)

    mount.innerHTML = ''
    mount.appendChild(wrap)
  }

  renderStats() {
    const mount = this.container.querySelector('#um-stats')
    if (!mount) return
    const grid = document.createElement('div')
    grid.className = 'um-grid'

    const card = (label, value) => {
      const c = document.createElement('div')
      c.className = 'um-stat'
      const h = this.h('div', 'h', label)
      const v = this.h('div', 'v', String(value))
      c.appendChild(h)
      c.appendChild(v)
      return c
    }

    grid.appendChild(card('Total Users', this.stats.totalUsers))
    grid.appendChild(card('Active Users', this.stats.activeUsers))
    grid.appendChild(card('Total Roles', this.stats.totalRoles))
    grid.appendChild(card('Total Permissions', this.stats.totalPermissions))

    mount.innerHTML = ''
    mount.appendChild(grid)
  }

  _createSearchControls() {
    const mount = this.container.querySelector('#um-table')
    if (!mount) return

    // Insert a permanent container ABOVE the table
    const controlsWrap = document.createElement('div')
    controlsWrap.id = 'um-search-permanent'
    controlsWrap.className = 'um-row'
    mount.parentNode.insertBefore(controlsWrap, mount)

    // Spacer
    controlsWrap.appendChild(this.h('span', 'um-spacer', ''))

    // ---- PERMANENT INPUT ----
    this.searchInput = document.createElement('input')
    this.searchInput.className = 'ms-input'
    this.searchInput.placeholder = 'Filter table...'
    this.searchInput.autocomplete = 'off'
    this.searchInput.setAttribute('data-form-type', 'other')
    controlsWrap.appendChild(this.searchInput)

    // ---- PERMANENT CLEAR BUTTON ----
    this.clearBtn = this.button('Clear', () => this._clearSearch())
    this.clearBtn.style.fontSize = '12px'
    this.clearBtn.style.padding = '6px 10px'
    controlsWrap.appendChild(this.clearBtn)

    // ---- ONE-TIME EVENT LISTENERS (NO DEBOUNCE) ----
    this.searchInput.addEventListener('input', (e) => {
      this.searchQ = e.target.value
      this.offset = 0
      this.fetchUsers().then(() => this.renderBody())
    })

    // Prevent autofill junk
    this.searchInput.addEventListener('focus', () => {
      if (
        this.searchInput.value &&
        this.searchInput.value.includes('@') &&
        this.searchQ !== this.searchInput.value
      ) {
        this.searchInput.value = this.searchQ = ''
      }
    })
  }

  // renderBody() {
  //   const mount = this.container.querySelector('#um-table')
  //   if (!mount) return
  //   const wrap = document.createElement('div')
  //   wrap.className = 'um-table'

  //   // Table-level search box at top right
  //   const controls = document.createElement('div')
  //   controls.className = 'um-row'
  //   controls.appendChild(this.h('span', 'um-spacer', ''))
  //   const search = document.createElement('input')
  //   search.className = 'ms-input'
  //   search.placeholder = 'Filter table...'
  //   search.value = this.searchQ
  //   search.autocomplete = 'off'
  //   search.setAttribute('data-form-type', 'other')
  //   search.addEventListener('input', (e) => {
  //     this.searchQ = e.target.value
  //     this.offset = 0
  //     // Debounce the API call to avoid too many requests and focus loss
  //     clearTimeout(this.searchTimeout)
  //     this.searchTimeout = setTimeout(async () => {
  //       await this.fetchUsers()
  //       this.renderBody()
  //     }, 300)
  //   })
  //   // Prevent browser auto-fill by clearing on focus if it looks like auto-filled email
  //   search.addEventListener('focus', () => {
  //     if (
  //       search.value &&
  //       search.value.includes('@') &&
  //       this.searchQ !== search.value
  //     ) {
  //       search.value = ''
  //       this.searchQ = ''
  //     }
  //   })
  //   controls.appendChild(search)

  //   // Clear button next to search
  //   const clearBtn = this.button('Clear', () => {
  //     this.searchQ = ''
  //     this.offset = 0
  //     search.value = ''
  //     this.fetchUsers().then(() => this.renderBody())
  //   })
  //   clearBtn.style.fontSize = '12px'
  //   clearBtn.style.padding = '6px 10px'
  //   controls.appendChild(clearBtn)

  //   wrap.appendChild(controls)

  //   const table = document.createElement('table')
  //   const thead = document.createElement('thead')
  //   const thr = document.createElement('tr')
  //   const headers = [
  //     '#',
  //     'First Name',
  //     'Last Name',
  //     'Full Name',
  //     'Active',
  //     'CompanyId',
  //   ]
  //   headers.forEach((h) => {
  //     const th = document.createElement('th')
  //     th.textContent = h
  //     thr.appendChild(th)
  //   })
  //   thead.appendChild(thr)
  //   table.appendChild(thead)

  //   const tbody = document.createElement('tbody')
  //   if (!Array.isArray(this.users) || this.users.length === 0) {
  //     const tr = document.createElement('tr')
  //     const td = document.createElement('td')
  //     td.colSpan = headers.length
  //     td.textContent = 'No users'
  //     tr.appendChild(td)
  //     tbody.appendChild(tr)
  //   } else {
  //     this.users.forEach((u, idx) => {
  //       const tr = document.createElement('tr')
  //       const cols = [
  //         String(idx + 1 + this.offset),
  //         u.firstName || '',
  //         u.lastName || '',
  //         u.fullName || '',
  //         u.isActive === 1 || u.isActive === true ? 'Yes' : 'No',
  //         u.companyId == null ? '' : String(u.companyId),
  //       ]
  //       cols.forEach((v) => {
  //         const td = document.createElement('td')
  //         td.textContent = v
  //         tr.appendChild(td)
  //       })
  //       tbody.appendChild(tr)
  //     })
  //   }
  //   table.appendChild(tbody)
  //   wrap.appendChild(table)

  //   // Pager
  //   const pager = document.createElement('div')
  //   pager.className = 'um-pager'
  //   const prev = this.button('Prev', async () => {
  //     if (this.offset >= this.limit) {
  //       this.offset -= this.limit
  //       await this.fetchUsers()
  //       this.renderBody()
  //     }
  //   })
  //   const next = this.button('Next', async () => {
  //     // naive next - if page is full assume next available
  //     this.offset += this.limit
  //     await this.fetchUsers()
  //     this.renderBody()
  //   })
  //   prev.disabled = this.offset <= 0
  //   pager.appendChild(prev)
  //   pager.appendChild(next)
  //   wrap.appendChild(pager)

  //   mount.innerHTML = ''
  //   mount.appendChild(wrap)
  // }

  _clearSearch() {
    this.searchQ = ''
    this.offset = 0
    this.searchInput.value = ''
    this.fetchUsers().then(() => this.renderBody())
  }

  renderBody() {
    const mount = this.container.querySelector('#um-table')
    if (!mount) return

    // Keep the permanent search input in sync with state
    if (this.searchInput) {
      this.searchInput.value = this.searchQ
    }

    const wrap = document.createElement('div')
    wrap.className = 'um-table'

    // === TABLE ===
    const table = document.createElement('table')
    const thead = document.createElement('thead')
    const thr = document.createElement('tr')
    const headers = [
      '#',
      'First Name',
      'Last Name',
      'Full Name',
      'Active',
      'Role',
      'Company',
      'Actions',
    ]
    headers.forEach((h) => {
      const th = document.createElement('th')
      th.textContent = h
      thr.appendChild(th)
    })
    thead.appendChild(thr)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    if (!Array.isArray(this.users) || this.users.length === 0) {
      const tr = document.createElement('tr')
      const td = document.createElement('td')
      td.colSpan = headers.length
      td.textContent = 'No users'
      tr.appendChild(td)
      tbody.appendChild(tr)
    } else {
      this.users.forEach((u, idx) => {
        const tr = document.createElement('tr')
        const cols = [
          String(idx + 1 + this.offset),
          u.firstName || '',
          u.lastName || '',
          u.fullName || '',
          u.isActive === 1 || u.isActive === true ? 'Yes' : 'No',
          u.roleName ? `${u.roleName} (${u.roleScope})` : '',
          u.companyName || '',
          '', // Actions placeholder
        ]
        cols.forEach((v, colIdx) => {
          const td = document.createElement('td')
          if (colIdx === 7) {
            // Actions column
            const actionsDiv = document.createElement('div')
            actionsDiv.style.display = 'flex'
            actionsDiv.style.flexDirection = 'column'
            actionsDiv.style.gap = '4px'
            const editBtn = this.button(
              'Edit',
              () => this.openModal(u),
              'primary'
            )
            editBtn.style.fontSize = '12px'
            editBtn.style.padding = '4px 8px'
            const deleteBtn = this.button(
              'Delete',
              () => this.confirmDelete(u),
              'warn'
            )
            deleteBtn.style.fontSize = '12px'
            deleteBtn.style.padding = '4px 8px'
            actionsDiv.appendChild(editBtn)
            actionsDiv.appendChild(deleteBtn)
            td.appendChild(actionsDiv)
          } else {
            td.textContent = v
          }
          tr.appendChild(td)
        })
        tbody.appendChild(tr)
      })
    }
    table.appendChild(tbody)
    wrap.appendChild(table)

    // === PAGER ===
    const pager = document.createElement('div')
    pager.className = 'um-pager'
    const prev = this.button('Prev', async () => {
      if (this.offset >= this.limit) {
        this.offset -= this.limit
        await this.fetchUsers()
        this.renderBody()
      }
    })
    const next = this.button('Next', async () => {
      this.offset += this.limit
      await this.fetchUsers()
      this.renderBody()
    })
    prev.disabled = this.offset <= 0
    pager.appendChild(prev)
    pager.appendChild(next)
    wrap.appendChild(pager)

    // === REPLACE ONLY THE TABLE ===
    mount.innerHTML = ''
    mount.appendChild(wrap)
  }

  renderModal() {
    const mount = this.container.querySelector('#um-modal')
    if (!mount) return
    mount.innerHTML = ''
    const overlay = document.createElement('div')
    overlay.className = 'um-modal' + (this.modalOpen ? ' open' : '')

    const panel = document.createElement('div')
    panel.className = 'panel'
    const hd = this.h('div', 'hd', this.editingUser ? 'Edit User' : 'Add User')
    const bd = document.createElement('div')
    bd.className = 'bd'

    const form = document.createElement('div')
    form.id = 'um-adduser-form'
    form.className = 'um-form'

    const row = (label, inputEl) => {
      const r = document.createElement('div')
      r.className = 'row'
      const lab = document.createElement('label')
      lab.textContent = label
      r.appendChild(lab)
      r.appendChild(inputEl)
      return r
    }

    const inpEmail = document.createElement('input')
    inpEmail.className = 'ms-input'
    inpEmail.name = 'email'
    inpEmail.type = 'email'
    inpEmail.value = this.editingUser ? this.editingUser.email : ''
    inpEmail.disabled = !!this.editingUser // Email cannot be changed on edit
    form.appendChild(row('Email', inpEmail))

    const inpFN = document.createElement('input')
    inpFN.className = 'ms-input'
    inpFN.name = 'firstName'
    inpFN.value = this.editingUser ? this.editingUser.firstName || '' : ''
    form.appendChild(row('First Name', inpFN))

    const inpLN = document.createElement('input')
    inpLN.className = 'ms-input'
    inpLN.name = 'lastName'
    inpLN.value = this.editingUser ? this.editingUser.lastName || '' : ''
    form.appendChild(row('Last Name', inpLN))

    const inpPwd = document.createElement('input')
    inpPwd.className = 'ms-input'
    inpPwd.name = 'password'
    inpPwd.type = 'password'
    inpPwd.placeholder = this.editingUser ? '(leave blank to keep current)' : ''
    form.appendChild(row('Password', inpPwd))

    // role select
    const selRole = document.createElement('select')
    selRole.className = 'ms-select'
    selRole.name = 'role'
    selRole.appendChild(new Option('Select role...', ''))
    for (const r of this.roles) {
      const lbl = `${r.name} (${r.scope})`
      selRole.appendChild(new Option(lbl, r.name))
    }
    // Pre-select role if editing
    if (this.editingUser && this.editingUser.roleName) {
      selRole.value = this.editingUser.roleName
    }
    form.appendChild(row('Role', selRole))

    // company select (for superadmin only)
    if (this.isSuperadmin()) {
      const selCo = document.createElement('select')
      selCo.className = 'ms-select'
      selCo.name = 'companyId'
      selCo.appendChild(new Option('Select company...', ''))
      for (const c of this.companies) {
        selCo.appendChild(new Option(c.name, String(c.id)))
      }
      if (this.editingUser) {
        selCo.value = this.editingUser.companyId
          ? String(this.editingUser.companyId)
          : ''
      }
      form.appendChild(row('Company', selCo))
    }

    bd.appendChild(form)

    const actions = document.createElement('div')
    actions.className = 'um-row'
    const spacer = this.h('span', 'um-spacer', '')
    const btnCancel = this.button('Cancel', () => this.closeModal())
    const btnCreate = this.button(
      this.editingUser ? 'Update' : 'Create',
      () => this.createUserFromModal(),
      'success'
    )
    actions.appendChild(spacer)
    actions.appendChild(btnCancel)
    actions.appendChild(btnCreate)

    panel.appendChild(hd)
    panel.appendChild(bd)
    panel.appendChild(actions)
    overlay.appendChild(panel)

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeModal()
    })

    mount.appendChild(overlay)
  }

  // ---------- UI utils ----------
  button(label, onClick, variant = '') {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'ms-btn' + (variant ? ` ${variant}` : '')
    b.textContent = label
    b.addEventListener('click', onClick)
    return b
  }
  h(tag, className, text) {
    const el = document.createElement(tag)
    if (className) el.className = className
    if (text != null) el.textContent = text
    return el
  }

  destroy() {
    this.container.innerHTML = ''
  }
}

// Expose globally
window.UsersComponent = UMUsersComponent

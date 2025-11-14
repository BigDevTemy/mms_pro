/**
 * RolesComponent - Role Management dashboard
 * - Dynamic stats: Total Roles, Company Roles, Global Roles
 * - Roles table with search and pagination
 * - Add Role modal (name, scope)
 * - Edit/Delete actions
 */
class RolesComponent {
  constructor(container) {
    this.container = container

    // State
    this.loading = false
    this.error = null

    this.stats = {
      totalRoles: 0,
      companyRoles: 0,
      globalRoles: 0,
    }
    this.roles = []
    this.limit = 10
    this.offset = 0
    this.searchQ = ''
    this.modalOpen = false
    this.editingRole = null // for edit mode
    this.searchInput = null
    this.clearBtn = null

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
      await Promise.all([this.fetchStats(), this.fetchRoles()])
    } catch (e) {
      this.error = e?.error || 'Failed to load role data'
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
      const res = await this.getJson('/admin/stats')
      this.stats = {
        totalRoles: res?.totalRoles || 0,
        companyRoles: this.roles.filter((r) => r.scope === 'company').length,
        globalRoles: this.roles.filter((r) => r.scope === 'global').length,
      }
    } catch {
      this.stats = {
        totalRoles: 0,
        companyRoles: 0,
        globalRoles: 0,
      }
    }
  }

  async fetchRoles() {
    try {
      const qs = this.buildQuery({
        q: this.searchQ || '',
        limit: this.limit,
        offset: this.offset,
      })
      const res = await this.getJson(`/admin/roles${qs}`)
      this.roles = Array.isArray(res?.items) ? res.items : []
    } catch (e) {
      this.roles = []
    }
  }

  // ---------- Actions ----------
  async reloadAll() {
    this.loading = true
    this.renderHeader()
    try {
      await Promise.all([this.fetchStats(), this.fetchRoles()])
    } finally {
      this.loading = false
      this.renderHeader()
      this.renderBody()
    }
  }

  openModal(role = null) {
    this.modalOpen = true
    this.editingRole = role
    this.renderModal()
  }
  closeModal() {
    this.modalOpen = false
    this.editingRole = null
    this.renderModal()
  }

  async createRoleFromModal() {
    const token = localStorage.getItem('token') || ''
    if (!token) {
      window.showToast('Login required', false)
      return
    }
    const form = this.container.querySelector('#rc-addrole-form')
    if (!form) return
    const name = form.querySelector('[name="name"]').value.trim()
    const scope = form.querySelector('[name="scope"]').value

    if (!name || !scope) {
      window.showToast('Please fill name and scope', false)
      return
    }

    const payload = { name, scope }

    try {
      if (this.editingRole) {
        await this.putJson(`/admin/roles/${this.editingRole.id}`, payload)
        window.showToast('Role updated')
      } else {
        await this.postJson('/admin/roles', payload)
        window.showToast('Role created')
      }
      this.closeModal()
      await this.reloadAll()
    } catch (e) {
      window.showToast(e?.error || 'Operation failed', false)
    }
  }

  async confirmDelete(role) {
    if (
      confirm(
        `Are you sure you want to delete role "${role.name}"? This action cannot be undone.`
      )
    ) {
      try {
        await this.deleteJson(`/admin/roles/${role.id}`)
        window.showToast('Role deleted')
        await this.reloadAll()
      } catch (e) {
        window.showToast(e?.error || 'Delete failed', false)
      }
    }
  }

  // ---------- Rendering ----------
  renderShell() {
    this.container.innerHTML = `
      <div class="ms-card">
        <div class="hd">Role Management</div>
        <div class="bd">
          <div id="rc-header"></div>
          <div id="rc-stats"></div>
          <div id="rc-table"></div>
          <div id="rc-modal"></div>
        </div>
      </div>
    `
    const style = document.createElement('style')
    style.textContent = `
      .rc-row { display:flex; align-items:center; gap:10px; flex-wrap: wrap; margin-bottom: 10px; }
      .rc-spacer { flex: 1; }
      .rc-grid { display:grid; grid-template-columns: repeat(3, minmax(200px,1fr)); gap:12px; margin-bottom: 14px; }
      .rc-stat { border:1px solid #e5e7eb; border-radius:10px; padding:12px; background:#fff; }
      .rc-stat .h { font-size:12px; color:#6b7280; }
      .rc-stat .v { font-size:20px; font-weight:700; color:#111827; margin-top:4px; }
      .rc-table table { width:100%; border-collapse:collapse; }
      .rc-table th, .rc-table td { text-align:left; border-bottom:1px solid #e5e7eb; padding:6px 8px; }
      .rc-table th { background:#f9fafb; }
      .rc-pager { display:flex; gap:8px; justify-content:flex-end; margin-top:10px; }
      .rc-modal { position:fixed; inset:0; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,0.4); }
      .rc-modal.open { display:flex; }
      .rc-modal .panel { width:420px; background:#fff; border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,0.15); overflow:hidden; }
      .rc-modal .panel .hd { padding:12px 14px; font-weight:700; border-bottom:1px solid #eee; }
      .rc-modal .panel .bd { padding:14px; }
      .rc-form .row { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
      .rc-form .row label { width:100px; color:#6b7280; font-size:12px; }
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
    const mount = this.container.querySelector('#rc-header')
    if (!mount) return
    const wrap = document.createElement('div')
    wrap.className = 'rc-row'

    // Reload
    const btnReload = this.button(
      this.loading ? 'Loading...' : 'Reload',
      async () => {
        await this.reloadAll()
      }
    )
    wrap.appendChild(btnReload)

    // Add role
    const btnAdd = this.button('Add Role', () => this.openModal(), 'success')
    btnAdd.disabled = !!this.loading
    wrap.appendChild(btnAdd)

    mount.innerHTML = ''
    mount.appendChild(wrap)
  }

  renderStats() {
    const mount = this.container.querySelector('#rc-stats')
    if (!mount) return
    const grid = document.createElement('div')
    grid.className = 'rc-grid'

    const card = (label, value) => {
      const c = document.createElement('div')
      c.className = 'rc-stat'
      const h = this.h('div', 'h', label)
      const v = this.h('div', 'v', String(value))
      c.appendChild(h)
      c.appendChild(v)
      return c
    }

    grid.appendChild(card('Total Roles', this.stats.totalRoles))
    grid.appendChild(card('Company Roles', this.stats.companyRoles))
    grid.appendChild(card('Global Roles', this.stats.globalRoles))

    mount.innerHTML = ''
    mount.appendChild(grid)
  }

  _createSearchControls() {
    const mount = this.container.querySelector('#rc-table')
    if (!mount) return

    const controlsWrap = document.createElement('div')
    controlsWrap.id = 'rc-search-permanent'
    controlsWrap.className = 'rc-row'
    mount.parentNode.insertBefore(controlsWrap, mount)

    controlsWrap.appendChild(this.h('span', 'rc-spacer', ''))

    this.searchInput = document.createElement('input')
    this.searchInput.className = 'ms-input'
    this.searchInput.placeholder = 'Filter table...'
    this.searchInput.autocomplete = 'off'
    this.searchInput.setAttribute('data-form-type', 'other')
    controlsWrap.appendChild(this.searchInput)

    this.clearBtn = this.button('Clear', () => this._clearSearch())
    this.clearBtn.style.fontSize = '12px'
    this.clearBtn.style.padding = '6px 10px'
    controlsWrap.appendChild(this.clearBtn)

    this.searchInput.addEventListener('input', (e) => {
      this.searchQ = e.target.value
      this.offset = 0
      this.fetchRoles().then(() => this.renderBody())
    })
  }

  _clearSearch() {
    this.searchQ = ''
    this.offset = 0
    this.searchInput.value = ''
    this.fetchRoles().then(() => this.renderBody())
  }

  renderBody() {
    const mount = this.container.querySelector('#rc-table')
    if (!mount) return

    if (this.searchInput) {
      this.searchInput.value = this.searchQ
    }

    const wrap = document.createElement('div')
    wrap.className = 'rc-table'

    const table = document.createElement('table')
    const thead = document.createElement('thead')
    const thr = document.createElement('tr')
    const headers = ['#', 'Name', 'Scope', 'Actions']
    headers.forEach((h) => {
      const th = document.createElement('th')
      th.textContent = h
      thr.appendChild(th)
    })
    thead.appendChild(thr)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    if (!Array.isArray(this.roles) || this.roles.length === 0) {
      const tr = document.createElement('tr')
      const td = document.createElement('td')
      td.colSpan = headers.length
      td.textContent = 'No roles'
      tr.appendChild(td)
      tbody.appendChild(tr)
    } else {
      this.roles.forEach((r, idx) => {
        const tr = document.createElement('tr')
        const cols = [
          String(idx + 1 + this.offset),
          r.name || '',
          r.scope || '',
          '', // Actions
        ]
        cols.forEach((v, colIdx) => {
          const td = document.createElement('td')
          if (colIdx === 3) {
            const editBtn = this.button(
              'Edit',
              () => this.openModal(r),
              'primary'
            )
            editBtn.style.fontSize = '12px'
            editBtn.style.padding = '4px 8px'
            const deleteBtn = this.button(
              'Delete',
              () => this.confirmDelete(r),
              'warn'
            )
            deleteBtn.style.fontSize = '12px'
            deleteBtn.style.padding = '4px 8px'
            td.appendChild(editBtn)
            td.appendChild(deleteBtn)
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

    const pager = document.createElement('div')
    pager.className = 'rc-pager'
    const prev = this.button('Prev', async () => {
      if (this.offset >= this.limit) {
        this.offset -= this.limit
        await this.fetchRoles()
        this.renderBody()
      }
    })
    const next = this.button('Next', async () => {
      this.offset += this.limit
      await this.fetchRoles()
      this.renderBody()
    })
    prev.disabled = this.offset <= 0
    pager.appendChild(prev)
    pager.appendChild(next)
    wrap.appendChild(pager)

    mount.innerHTML = ''
    mount.appendChild(wrap)
  }

  renderModal() {
    const mount = this.container.querySelector('#rc-modal')
    if (!mount) return
    mount.innerHTML = ''
    const overlay = document.createElement('div')
    overlay.className = 'rc-modal' + (this.modalOpen ? ' open' : '')

    const panel = document.createElement('div')
    panel.className = 'panel'
    const hd = this.h('div', 'hd', this.editingRole ? 'Edit Role' : 'Add Role')
    const bd = document.createElement('div')
    bd.className = 'bd'

    const form = document.createElement('div')
    form.id = 'rc-addrole-form'
    form.className = 'rc-form'

    const row = (label, inputEl) => {
      const r = document.createElement('div')
      r.className = 'row'
      const lab = document.createElement('label')
      lab.textContent = label
      r.appendChild(lab)
      r.appendChild(inputEl)
      return r
    }

    const inpName = document.createElement('input')
    inpName.className = 'ms-input'
    inpName.name = 'name'
    inpName.value = this.editingRole ? this.editingRole.name : ''
    inpName.disabled = !!this.editingRole
    form.appendChild(row('Name', inpName))

    const selScope = document.createElement('select')
    selScope.className = 'ms-select'
    selScope.name = 'scope'
    selScope.appendChild(new Option('Select scope...', ''))
    selScope.appendChild(new Option('global', 'global'))
    selScope.appendChild(new Option('company', 'company'))
    if (this.editingRole) {
      selScope.value = this.editingRole.scope
    }
    form.appendChild(row('Scope', selScope))

    bd.appendChild(form)

    const actions = document.createElement('div')
    actions.className = 'rc-row'
    const spacer = this.h('span', 'rc-spacer', '')
    const btnCancel = this.button('Cancel', () => this.closeModal())
    const btnCreate = this.button(
      this.editingRole ? 'Update' : 'Create',
      () => this.createRoleFromModal(),
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
window.RolesComponent = RolesComponent

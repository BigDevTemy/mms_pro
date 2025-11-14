/**
 * PermissionsComponent - Permission Management dashboard
 * - Dynamic stats: Total Permissions
 * - Permissions table with search and pagination
 * - Add Permission modal (name)
 * - Edit/Delete actions
 */
class PermissionsComponent {
  constructor(container) {
    this.container = container

    // State
    this.loading = false
    this.error = null

    this.stats = {
      totalPermissions: 0,
    }
    this.permissions = []
    this.limit = 10
    this.offset = 0
    this.searchQ = ''
    this.modalOpen = false
    this.editingPermission = null // for edit mode
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
      await Promise.all([this.fetchStats(), this.fetchPermissions()])
    } catch (e) {
      this.error = e?.error || 'Failed to load permission data'
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
        totalPermissions: res?.totalPermissions || 0,
      }
    } catch {
      this.stats = {
        totalPermissions: 0,
      }
    }
  }

  async fetchPermissions() {
    try {
      const qs = this.buildQuery({
        q: this.searchQ || '',
        limit: this.limit,
        offset: this.offset,
      })
      const res = await this.getJson(`/admin/permissions${qs}`)
      this.permissions = Array.isArray(res?.items) ? res.items : []
    } catch (e) {
      this.permissions = []
    }
  }

  // ---------- Actions ----------
  async reloadAll() {
    this.loading = true
    this.renderHeader()
    try {
      await Promise.all([this.fetchStats(), this.fetchPermissions()])
    } finally {
      this.loading = false
      this.renderHeader()
      this.renderBody()
    }
  }

  openModal(permission = null) {
    this.modalOpen = true
    this.editingPermission = permission
    this.renderModal()
  }
  closeModal() {
    this.modalOpen = false
    this.editingPermission = null
    this.renderModal()
  }

  async createPermissionFromModal() {
    const token = localStorage.getItem('token') || ''
    if (!token) {
      window.showToast('Login required', false)
      return
    }
    const form = this.container.querySelector('#pc-addpermission-form')
    if (!form) return
    const name = form.querySelector('[name="name"]').value.trim()

    if (!name) {
      window.showToast('Please fill name', false)
      return
    }

    const payload = { name }

    try {
      if (this.editingPermission) {
        await this.putJson(
          `/admin/permissions/${this.editingPermission.id}`,
          payload
        )
        window.showToast('Permission updated')
      } else {
        await this.postJson('/admin/permissions', payload)
        window.showToast('Permission created')
      }
      this.closeModal()
      await this.reloadAll()
    } catch (e) {
      window.showToast(e?.error || 'Operation failed', false)
    }
  }

  async confirmDelete(permission) {
    if (
      confirm(
        `Are you sure you want to delete permission "${permission.name}"? This action cannot be undone.`
      )
    ) {
      try {
        await this.deleteJson(`/admin/permissions/${permission.id}`)
        window.showToast('Permission deleted')
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
        <div class="hd">Permission Management</div>
        <div class="bd">
          <div id="pc-header"></div>
          <div id="pc-stats"></div>
          <div id="pc-table"></div>
          <div id="pc-modal"></div>
        </div>
      </div>
    `
    const style = document.createElement('style')
    style.textContent = `
      .pc-row { display:flex; align-items:center; gap:10px; flex-wrap: wrap; margin-bottom: 10px; }
      .pc-spacer { flex: 1; }
      .pc-grid { display:grid; grid-template-columns: repeat(1, minmax(200px,1fr)); gap:12px; margin-bottom: 14px; }
      .pc-stat { border:1px solid #e5e7eb; border-radius:10px; padding:12px; background:#fff; }
      .pc-stat .h { font-size:12px; color:#6b7280; }
      .pc-stat .v { font-size:20px; font-weight:700; color:#111827; margin-top:4px; }
      .pc-table table { width:100%; border-collapse:collapse; }
      .pc-table th, .pc-table td { text-align:left; border-bottom:1px solid #e5e7eb; padding:6px 8px; }
      .pc-table th { background:#f9fafb; }
      .pc-pager { display:flex; gap:8px; justify-content:flex-end; margin-top:10px; }
      .pc-modal { position:fixed; inset:0; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,0.4); }
      .pc-modal.open { display:flex; }
      .pc-modal .panel { width:420px; background:#fff; border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,0.15); overflow:hidden; }
      .pc-modal .panel .hd { padding:12px 14px; font-weight:700; border-bottom:1px solid #eee; }
      .pc-modal .panel .bd { padding:14px; }
      .pc-form .row { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
      .pc-form .row label { width:100px; color:#6b7280; font-size:12px; }
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
    const mount = this.container.querySelector('#pc-header')
    if (!mount) return
    const wrap = document.createElement('div')
    wrap.className = 'pc-row'

    // Reload
    const btnReload = this.button(
      this.loading ? 'Loading...' : 'Reload',
      async () => {
        await this.reloadAll()
      }
    )
    wrap.appendChild(btnReload)

    // Add permission
    const btnAdd = this.button(
      'Add Permission',
      () => this.openModal(),
      'success'
    )
    btnAdd.disabled = !!this.loading
    wrap.appendChild(btnAdd)

    mount.innerHTML = ''
    mount.appendChild(wrap)
  }

  renderStats() {
    const mount = this.container.querySelector('#pc-stats')
    if (!mount) return
    const grid = document.createElement('div')
    grid.className = 'pc-grid'

    const card = (label, value) => {
      const c = document.createElement('div')
      c.className = 'pc-stat'
      const h = this.h('div', 'h', label)
      const v = this.h('div', 'v', String(value))
      c.appendChild(h)
      c.appendChild(v)
      return c
    }

    grid.appendChild(card('Total Permissions', this.stats.totalPermissions))

    mount.innerHTML = ''
    mount.appendChild(grid)
  }

  _createSearchControls() {
    const mount = this.container.querySelector('#pc-table')
    if (!mount) return

    const controlsWrap = document.createElement('div')
    controlsWrap.id = 'pc-search-permanent'
    controlsWrap.className = 'pc-row'
    mount.parentNode.insertBefore(controlsWrap, mount)

    controlsWrap.appendChild(this.h('span', 'pc-spacer', ''))

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
      this.fetchPermissions().then(() => this.renderBody())
    })
  }

  _clearSearch() {
    this.searchQ = ''
    this.offset = 0
    this.searchInput.value = ''
    this.fetchPermissions().then(() => this.renderBody())
  }

  renderBody() {
    const mount = this.container.querySelector('#pc-table')
    if (!mount) return

    if (this.searchInput) {
      this.searchInput.value = this.searchQ
    }

    const wrap = document.createElement('div')
    wrap.className = 'pc-table'

    const table = document.createElement('table')
    const thead = document.createElement('thead')
    const thr = document.createElement('tr')
    const headers = ['#', 'Name', 'Actions']
    headers.forEach((h) => {
      const th = document.createElement('th')
      th.textContent = h
      thr.appendChild(th)
    })
    thead.appendChild(thr)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    if (!Array.isArray(this.permissions) || this.permissions.length === 0) {
      const tr = document.createElement('tr')
      const td = document.createElement('td')
      td.colSpan = headers.length
      td.textContent = 'No permissions'
      tr.appendChild(td)
      tbody.appendChild(tr)
    } else {
      this.permissions.forEach((p, idx) => {
        const tr = document.createElement('tr')
        const cols = [
          String(idx + 1 + this.offset),
          p.name || '',
          '', // Actions
        ]
        cols.forEach((v, colIdx) => {
          const td = document.createElement('td')
          if (colIdx === 2) {
            const editBtn = this.button(
              'Edit',
              () => this.openModal(p),
              'primary'
            )
            editBtn.style.fontSize = '12px'
            editBtn.style.padding = '4px 8px'
            const deleteBtn = this.button(
              'Delete',
              () => this.confirmDelete(p),
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
    pager.className = 'pc-pager'
    const prev = this.button('Prev', async () => {
      if (this.offset >= this.limit) {
        this.offset -= this.limit
        await this.fetchPermissions()
        this.renderBody()
      }
    })
    const next = this.button('Next', async () => {
      this.offset += this.limit
      await this.fetchPermissions()
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
    const mount = this.container.querySelector('#pc-modal')
    if (!mount) return
    mount.innerHTML = ''
    const overlay = document.createElement('div')
    overlay.className = 'pc-modal' + (this.modalOpen ? ' open' : '')

    const panel = document.createElement('div')
    panel.className = 'panel'
    const hd = this.h(
      'div',
      'hd',
      this.editingPermission ? 'Edit Permission' : 'Add Permission'
    )
    const bd = document.createElement('div')
    bd.className = 'bd'

    const form = document.createElement('div')
    form.id = 'pc-addpermission-form'
    form.className = 'pc-form'

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
    inpName.value = this.editingPermission ? this.editingPermission.name : ''
    inpName.disabled = !!this.editingPermission
    form.appendChild(row('Name', inpName))

    bd.appendChild(form)

    const actions = document.createElement('div')
    actions.className = 'pc-row'
    const spacer = this.h('span', 'pc-spacer', '')
    const btnCancel = this.button('Cancel', () => this.closeModal())
    const btnCreate = this.button(
      this.editingPermission ? 'Update' : 'Create',
      () => this.createPermissionFromModal(),
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
window.PermissionsComponent = PermissionsComponent

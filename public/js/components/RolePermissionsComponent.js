/**
 * RolePermissionsComponent - Role-Permission Assignment Management
 * - Left panel: Roles list with stats
 * - Right panel: Permissions matrix for selected role
 * - Intuitive UI with checkboxes for bulk assignment
 * - Search and filter capabilities
 */
class RolePermissionsComponent {
  constructor(container) {
    this.container = container

    // State
    this.loading = false
    this.error = null
    this.roles = []
    this.permissions = []
    this.selectedRoleId = null
    this.rolePermissions = new Map() // roleId -> Set of permissionIds
    this.stagedPermissions = new Map() // roleId -> Set (staged, unsaved)
    this.searchQuery = ''
    this.permissionSearch = ''

    this.init()
  }

  async init() {
    this.renderLayout()
    this.setupEventListeners()
    await this.loadData()
  }

  renderLayout() {
    this.container.innerHTML = `
      <div class="rp-header">
        <h2>Role-Permission Assignments</h2>
        <div class="rp-stats">
          <div class="stat-card">
            <div class="stat-number" id="totalRoles">0</div>
            <div class="stat-label">Total Roles</div>
          </div>
          <div class="stat-card">
            <div class="stat-number" id="totalPermissions">0</div>
            <div class="stat-label">Total Permissions</div>
          </div>
          <div class="stat-card">
            <div class="stat-number" id="assignedPermissions">0</div>
            <div class="stat-label">Assigned Permissions</div>
          </div>
        </div>
      </div>

      <div class="rp-content">
        <!-- Left Panel: Roles -->
        <div class="rp-left-panel" >
          <div class="rp-panel-header">
            <h3>Roles</h3>
            <div class="search-container" >
              <input type="text" id="roleSearch" class="form-control" placeholder="Search roles...">
            </div>
          </div>
          <div class="rp-roles-list" id="rolesList">
            <!-- Roles will be populated here -->
          </div>
        </div>

        <!-- Right Panel: Permissions Matrix -->
        <div class="rp-right-panel">
          <div class="rp-panel-header">
            <h3 id="permissionsTitle">Select a Role</h3>
            <div class="search-container">
              <input type="text" id="permissionSearch" class="form-control" placeholder="Search permissions...">
            </div>
            <div class="rp-actions">
              <button id="saveChangesBtn" class="btn btn-primary" disabled>Save changes</button>
              <button id="revertChangesBtn" class="btn btn-secondary" disabled>Revert</button>
            </div>
          </div>
          <div class="rp-permissions-matrix" id="permissionsMatrix">
            <div class="rp-placeholder">
              <p>Select a role from the left panel to manage its permissions.</p>
            </div>
          </div>
        </div>
      </div>
    `

    // Add styles
    const style = document.createElement('style')
    style.textContent = `
      .rp-header { margin-bottom: 20px; }
      .rp-header h2 { margin-bottom: 15px; color: #1f2937; }
      .rp-stats { display: flex; gap: 20px; }
      .stat-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 15px; text-align: center; min-width: 120px; }
      .stat-number { font-size: 24px; font-weight: bold; color: #2563eb; }
      .stat-label { font-size: 12px; color: #6b7280; margin-top: 5px; }

      .rp-content { display: grid; grid-template-columns: 300px 1fr; gap: 20px; height: calc(100vh - 200px); }
      .rp-left-panel, .rp-right-panel { border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; }
      .rp-panel-header { padding: 15px; border-bottom: 1px solid #e5e7eb; }
      .rp-panel-header h3 { margin: 0 0 10px 0; color: #1f2937; }
      .search-container { margin-top: 10px; }

      .rp-roles-list { max-height: calc(100vh - 300px); overflow-y: auto; }
      .rp-role-item { padding: 12px 15px; border-bottom: 1px solid #f3f4f6; cursor: pointer; transition: background-color 0.2s; }
      .rp-role-item:hover { background: #f9fafb; }
      .rp-role-item.selected { background: #eff6ff; border-left: 3px solid #2563eb; }
      .rp-role-name { font-weight: 500; color: #1f2937; }
      .rp-role-scope { font-size: 12px; color: #6b7280; margin-top: 2px; }
      .rp-permission-count { font-size: 11px; color: #059669; margin-top: 2px; }

      .rp-permissions-matrix { max-height: calc(100vh - 300px); overflow-y: auto; }
      .rp-permission-group { margin-bottom: 20px; }
      .rp-group-header { background: #f9fafb; padding: 8px 12px; border-radius: 4px; margin-bottom: 8px; }
      .rp-group-name { font-weight: 600; color: #374151; font-size: 14px; }
      .rp-permission-item { display: flex; align-items: center; padding: 8px 12px; border: 1px solid #f3f4f6; border-radius: 4px; margin-bottom: 4px; background: #fff; }
      .rp-permission-checkbox { margin-right: 10px; }
      .rp-permission-info { flex: 1; }
      .rp-permission-name { font-weight: 500; color: #1f2937; font-size: 14px; }
      .rp-permission-description { font-size: 12px; color: #6b7280; margin-top: 2px; }

      .rp-placeholder { display: flex; align-items: center; justify-content: center; height: 200px; color: #6b7280; }

      .form-control { width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; }
      .form-control:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1); }

      .rp-panel-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .rp-actions { display: flex; gap: 8px; align-items: center; }
      .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 6px; border: 1px solid #d1d5db; background: #fff; color: #111827; cursor: pointer; font-size: 14px; }
      .btn[disabled] { opacity: 0.6; cursor: not-allowed; }
      .btn-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
      .btn-secondary { background: #f3f4f6; }
    `
    this.container.appendChild(style)
  }

  setupEventListeners() {
    // Role search
    const roleSearch = this.container.querySelector('#roleSearch')
    roleSearch.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase()
      this.renderRolesList()
    })

    // Permission search
    const permissionSearch = this.container.querySelector('#permissionSearch')
    permissionSearch.addEventListener('input', (e) => {
      this.permissionSearch = e.target.value.toLowerCase()
      this.renderPermissionsMatrix()
    })

    // Actions
    const saveBtn = this.container.querySelector('#saveChangesBtn')
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveChanges())
    }
    const revertBtn = this.container.querySelector('#revertChangesBtn')
    if (revertBtn) {
      revertBtn.addEventListener('click', () => this.revertChanges())
    }
  }

  async loadData() {
    this.loading = true
    this.renderLoading()

    try {
      // Load roles and permissions in parallel
      const [rolesRes, permissionsRes] = await Promise.all([
        this.getJson('/admin/roles'),
        this.getJson('/admin/permissions'),
      ])

      // Normalize API responses that may return { items: [...] }
      const rawRoles = Array.isArray(rolesRes)
        ? rolesRes
        : rolesRes && rolesRes.items
        ? rolesRes.items
        : []
      const rawPerms = Array.isArray(permissionsRes)
        ? permissionsRes
        : permissionsRes && permissionsRes.items
        ? permissionsRes.items
        : []

      this.roles = Array.isArray(rawRoles) ? rawRoles : []
      this.permissions = Array.isArray(rawPerms) ? rawPerms : []

      // Load role-permission assignments
      await this.loadRolePermissions()

      this.updateStats()
      this.renderRolesList()
      this.renderPermissionsMatrix()
    } catch (error) {
      console.error('Error loading data:', error)
      this.error = error.error || 'Failed to load data'
      this.renderError()
    } finally {
      this.loading = false
    }
  }

  async loadRolePermissions() {
    // Load permissions for each role
    const promises = this.roles?.map((role) =>
      this.getJson(`/admin/roles/${role.id}/permissions`)
        .then((perms) => {
          const permIds = new Set((perms || []).map((p) => p.id))
          this.rolePermissions.set(role.id, permIds)
          return { roleId: role.id, permissions: permIds }
        })
        .catch(() => {
          // If endpoint doesn't exist yet, initialize empty
          this.rolePermissions.set(role.id, new Set())
        })
    )

    await Promise.all(promises)

    // Initialize staged selections as clones of current assignments
    this.roles.forEach((r) => {
      const base = this.rolePermissions.get(r.id) || new Set()
      this.stagedPermissions.set(r.id, new Set([...base]))
    })
  }

  updateStats() {
    const totalRoles = this.roles.length
    const totalPermissions = this.permissions.length
    let assignedPermissions = 0

    for (const permSet of this.rolePermissions.values()) {
      assignedPermissions += permSet.size
    }

    this.container.querySelector('#totalRoles').textContent = totalRoles
    this.container.querySelector('#totalPermissions').textContent =
      totalPermissions
    this.container.querySelector('#assignedPermissions').textContent =
      assignedPermissions
  }

  renderRolesList() {
    const container = this.container.querySelector('#rolesList')
    const filteredRoles = this.roles.filter(
      (role) =>
        role.name.toLowerCase().includes(this.searchQuery) ||
        (role.description &&
          role.description.toLowerCase().includes(this.searchQuery))
    )

    container.innerHTML = filteredRoles
      .map((role) => {
        const permCount = this.rolePermissions.get(role.id)?.size || 0
        const isSelected = this.selectedRoleId === role.id

        return `
        <div class="rp-role-item ${
          isSelected ? 'selected' : ''
        }" data-role-id="${role.id}">
          <div class="rp-role-name">${role.name}</div>
          <div class="rp-role-scope">${role.scope || 'global'}</div>
          <div class="rp-permission-count">${permCount} permissions</div>
        </div>
      `
      })
      .join('')

    // Add click handlers
    container.querySelectorAll('.rp-role-item').forEach((item) => {
      item.addEventListener('click', () => {
        const roleId = parseInt(item.getAttribute('data-role-id'))
        this.selectRole(roleId)
      })
    })
  }

  renderPermissionsMatrix() {
    const container = this.container.querySelector('#permissionsMatrix')
    const title = this.container.querySelector('#permissionsTitle')

    if (!this.selectedRoleId) {
      title.textContent = 'Select a Role'
      container.innerHTML = `
        <div class="rp-placeholder">
          <p>Select a role from the left panel to manage its permissions.</p>
        </div>
      `
      return
    }

    const selectedRole = this.roles.find((r) => r.id === this.selectedRoleId)
    title.textContent = `Permissions for ${selectedRole.name}`

    // Group permissions by resource
    const groupedPermissions = this.groupPermissionsByResource()

    container.innerHTML = Object.entries(groupedPermissions)
      .map(([resource, perms]) => {
        const filteredPerms = perms.filter(
          (perm) =>
            perm.name.toLowerCase().includes(this.permissionSearch) ||
            (perm.description &&
              perm.description.toLowerCase().includes(this.permissionSearch))
        )

        if (filteredPerms.length === 0) return ''

        return `
        <div class="rp-permission-group">
          <div class="rp-group-header">
            <div class="rp-group-name">${resource}</div>
          </div>
          ${filteredPerms
            .map((perm) => this.renderPermissionItem(perm))
            .join('')}
        </div>
      `
      })
      .join('')
  }

  renderPermissionItem(permission) {
    const rolePerms =
      this.stagedPermissions.get(this.selectedRoleId) || new Set()
    const isChecked = rolePerms.has(permission.id)

    return `
      <div class="rp-permission-item">
        <input type="checkbox"
               class="rp-permission-checkbox"
               data-permission-id="${permission.id}"
               ${isChecked ? 'checked' : ''}>
        <div class="rp-permission-info">
          <div class="rp-permission-name">${permission.name}</div>
          <div class="rp-permission-description">${
            permission.description || ''
          }</div>
        </div>
      </div>
    `
  }

  groupPermissionsByResource() {
    const groups = {}

    this.permissions.forEach((perm) => {
      // Extract resource from permission name (e.g., "user.create" -> "user")
      const parts = perm.name.split('.')
      const resource = parts.length > 1 ? parts[0] : 'general'

      if (!groups[resource]) {
        groups[resource] = []
      }
      groups[resource].push(perm)
    })

    return groups
  }

  selectRole(roleId) {
    this.selectedRoleId = roleId
    this.ensureStagedFor(roleId)
    this.renderRolesList()
    this.renderPermissionsMatrix()

    // Add event listeners for permission checkboxes
    setTimeout(() => {
      this.container
        .querySelectorAll('.rp-permission-checkbox')
        .forEach((checkbox) => {
          checkbox.addEventListener('change', (e) => {
            this.togglePermission(
              parseInt(e.target.getAttribute('data-permission-id')),
              e.target.checked
            )
          })
        })
    }, 0)

    this.updateActionButtons()
  }

  async togglePermission(permissionId, checked) {
    if (!this.selectedRoleId) return

    const roleId = this.selectedRoleId
    this.ensureStagedFor(roleId)
    const staged = this.stagedPermissions.get(roleId)

    if (checked) {
      staged.add(permissionId)
    } else {
      staged.delete(permissionId)
    }

    // Enable Save/Revert if there are pending diffs
    this.updateActionButtons()
  }

  renderLoading() {
    // Could add loading indicators if needed
  }

  renderError() {
    this.container.innerHTML = `
      <div class="alert alert-danger">
        <h4>Error</h4>
        <p>${this.error}</p>
      </div>
    `
  }

  // API helpers
  async getJson(path) {
    return window.getJson(path)
  }

  async postJson(path, body) {
    return window.postJson(path, body)
  }

  async deleteJson(path) {
    return window.deleteJson(path)
  }

  // Staging helpers and actions
  ensureStagedFor(roleId) {
    if (!this.stagedPermissions.has(roleId)) {
      const base = this.rolePermissions.get(roleId) || new Set()
      this.stagedPermissions.set(roleId, new Set([...base]))
    }
  }

  computeDiffs(originalSet, stagedSet) {
    const added = []
    const removed = []
    stagedSet.forEach((id) => {
      if (!originalSet.has(id)) added.push(id)
    })
    originalSet.forEach((id) => {
      if (!stagedSet.has(id)) removed.push(id)
    })
    return { added, removed }
  }

  hasPendingChanges(roleId) {
    const original = this.rolePermissions.get(roleId) || new Set()
    const staged = this.stagedPermissions.get(roleId) || new Set()
    const { added, removed } = this.computeDiffs(original, staged)
    return added.length > 0 || removed.length > 0
  }

  updateActionButtons() {
    const saveBtn = this.container.querySelector('#saveChangesBtn')
    const revertBtn = this.container.querySelector('#revertChangesBtn')
    const hasSel = !!this.selectedRoleId
    let pending = false
    if (hasSel) pending = this.hasPendingChanges(this.selectedRoleId)
    if (saveBtn) saveBtn.disabled = !(hasSel && pending)
    if (revertBtn) revertBtn.disabled = !(hasSel && pending)
  }

  async saveChanges() {
    if (!this.selectedRoleId) return
    const roleId = this.selectedRoleId
    const original = this.rolePermissions.get(roleId) || new Set()
    const staged = this.stagedPermissions.get(roleId) || new Set()
    const { added, removed } = this.computeDiffs(original, staged)
    if (added.length === 0 && removed.length === 0) {
      showToast('No changes to save')
      this.updateActionButtons()
      return
    }

    try {
      // Apply additions
      for (const pid of added) {
        await this.postJson(`/admin/roles/${roleId}/permissions`, {
          permission_id: pid,
        })
      }
      // Apply removals
      for (const pid of removed) {
        await this.deleteJson(`/admin/roles/${roleId}/permissions/${pid}`)
      }

      // Commit staged to current
      this.rolePermissions.set(roleId, new Set([...staged]))
      this.updateStats()
      this.renderRolesList()
      this.renderPermissionsMatrix()
      showToast('Changes saved')
    } catch (error) {
      console.error('Save failed:', error)
      showToast(error?.error || 'Failed to save changes', false)
      await this.syncRoleFromServer(roleId)
      this.renderPermissionsMatrix()
    } finally {
      this.updateActionButtons()
    }
  }

  async revertChanges() {
    if (!this.selectedRoleId) return
    const roleId = this.selectedRoleId
    const base = this.rolePermissions.get(roleId) || new Set()
    this.stagedPermissions.set(roleId, new Set([...base]))
    this.renderPermissionsMatrix()
    this.updateActionButtons()
  }

  async syncRoleFromServer(roleId) {
    try {
      const perms = await this.getJson(`/admin/roles/${roleId}/permissions`)
      const permIds = new Set((perms || []).map((p) => p.id))
      this.rolePermissions.set(roleId, permIds)
      this.stagedPermissions.set(roleId, new Set([...permIds]))
    } catch (e) {
      // ignore
    }
  }

  destroy() {
    this.container.innerHTML = ''
  }
}

// Expose globally
window.RolePermissionsComponent = RolePermissionsComponent

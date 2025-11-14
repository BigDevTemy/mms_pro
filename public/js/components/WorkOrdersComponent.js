/**
 * WorkOrdersComponent - Manage Work Orders raised from Tasks
 * - Stat cards (counts by status and priority)
 * - Filter/search toolbar (q, task, status, priority)
 * - Table with actions (Edit/Delete)
 * - Create/Edit modal
 * - Backed by:
 *    GET  /workorders
 *    GET  /workorders/stats
 *    POST /workorders
 *    PUT  /workorders/{id}
 *    DELETE /workorders/{id}
 *    (for task dropdown) GET /tasks
 */
class WorkOrdersComponent {
  constructor(container) {
    this.container = container

    // State
    this.loading = false
    this.error = null

    // Data
    this.stats = {
      total: 0,
      open: 0,
      assigned: 0,
      in_progress: 0,
      on_hold: 0,
      completed: 0,
      cancelled: 0,
      high: 0,
      medium: 0,
      low: 0,
    }
    this.items = []
    this.tasks = []
    this.machines = []
    this.lastChildTypeKey = null
    this.currentUser = null
    this.isSuper = false
    this.selectedCompanyId = null
    this.companies = []

    // Filters
    this.searchQuery = ''
    this.filterTaskId = ''
    this.filterStatus = ''
    this.filterPriority = ''
    this.limit = 20
    this.offset = 0

    // Modal state
    this.editing = null // if null => creating; else contains current workorder object

    this.init()
  }

  async init() {
    this.renderLayout()
    this.attachEventListeners()
    await this.loadMe()
    if (this.isSuper) {
      await this.loadCompanies()
    } else {
      this.selectedCompanyId = this.currentUser?.company_id || null
    }
    await this.loadTasks()
    await this.loadMachines()
    await this.refreshAll()
  }

  // Layout
  renderLayout() {
    this.container.innerHTML = `
      <div class="wo-header">
        <div class="title-area">
          <h2><i class="fas fa-clipboard-list"></i> Work Orders</h2>
          <p class="subtitle">Capture and track execution of maintenance tasks</p>
        </div>
        <div class="header-actions">
          <button id="createWOBtn" class="btn btn-primary">
            <i class="fas fa-plus"></i> Create Work Order
          </button>
        </div>
      </div>

      <div class="wo-stats" id="woStats">
        ${this.renderStatCardsPlaceholder()}
      </div>

      <div class="wo-toolbar">
        <div class="filters">
          <input id="woSearch" class="form-control" placeholder="Search work orders (title/description)..." />
          <select id="woTask" class="form-control">
            <option value="">All Tasks</option>
          </select>
          <select id="woStatus" class="form-control">
            <option value="">All Status</option>
            <option value="open">Open</option>
            <option value="assigned">Assigned</option>
            <option value="in_progress">In Progress</option>
            <option value="on_hold">On Hold</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select id="woPriority" class="form-control">
            <option value="">All Priority</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div class="toolbar-actions">
          <button id="refreshWOBtn" class="btn btn-secondary">
            <i class="fas fa-sync"></i> Refresh
          </button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="table wo-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Task</th>
              <th>Machine</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Due</th>
              <th>Assigned To</th>
              <th>Created</th>
              <th style="width:120px;">Actions</th>
            </tr>
          </thead>
          <tbody id="woTbody">
            <tr><td colspan="9" class="muted">No work orders yet.</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Create/Edit Modal -->
      <div class="modal" id="woModal" style="display:none;">
        <div class="modal-content">
          <div class="modal-header">
            <h3 id="woModalTitle">Create Work Order</h3>
            <span class="close-btn" id="closeWOModal">&times;</span>
          </div>
          <div class="modal-body">
            <form id="woForm">
              <div class="grid-2">
                <div class="form-group">
                  <label for="woTitle">Title</label>
                  <input id="woTitle" name="title" class="form-control" placeholder="e.g., Replace worn belt" required />
                </div>
                <div class="form-group">
                  <label for="woTaskSel">Task</label>
                  <select id="woTaskSel" name="taskId" class="form-control" required>
                    <option value="">Select Task</option>
                  </select>
                </div>
                <!-- Superadmin only: pick company to scope machine list -->
                <div class="form-group" id="woCompanyGroup" style="display:none;">
                  <label for="woCompanySel">Company</label>
                  <select id="woCompanySel" name="companyId" class="form-control">
                    <option value="">Select Company</option>
                  </select>
                </div>
                <div class="form-group">
                  <label for="woMachineSel">Machine (last-level)</label>
                  <select id="woMachineSel" name="machineRowId" class="form-control">
                    <option value="">Select Machine</option>
                  </select>
                </div>
                <div class="form-group">
                  <label for="woStatusSel">Status</label>
                  <select id="woStatusSel" name="status" class="form-control" required>
                    <option value="open" selected>Open</option>
                    <option value="assigned">Assigned</option>
                    <option value="in_progress">In Progress</option>
                    <option value="on_hold">On Hold</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div class="form-group">
                  <label for="woPrioritySel">Priority</label>
                  <select id="woPrioritySel" name="priority" class="form-control" required>
                    <option value="low">Low</option>
                    <option value="medium" selected>Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div class="form-group">
                  <label for="woDueDate">Due Date (optional)</label>
                  <input id="woDueDate" name="dueDate" class="form-control" type="date" />
                </div>
                <div class="form-group">
                  <label for="woAssignedTo">Assigned To (User ID - optional)</label>
                  <input id="woAssignedTo" name="assignedTo" class="form-control" type="number" min="1" placeholder="e.g., 42" />
                </div>
                <div class="form-group">
                  <label>
                    <input type="checkbox" id="woWasShutdown" name="wasShutdown" /> Machine was shutdown
                  </label>
                </div>
                <div class="form-group">
                  <label for="woShutdownStart">Shutdown Start</label>
                  <input id="woShutdownStart" name="shutdownStart" class="form-control" type="datetime-local" disabled />
                </div>
                <div class="form-group">
                  <label for="woShutdownEnd">Shutdown End</label>
                  <input id="woShutdownEnd" name="shutdownEnd" class="form-control" type="datetime-local" disabled />
                </div>
                <div class="form-group full">
                  <label for="woDesc">Description</label>
                  <textarea id="woDesc" name="description" class="form-control" rows="4" placeholder="Describe the task execution steps / findings..."></textarea>
                </div>
              </div>
              <div class="modal-actions">
                <button type="button" id="cancelWOBtn" class="btn">Cancel</button>
                <button type="submit" class="btn btn-primary">
                  <i class="fas fa-check"></i> <span id="woSubmitText">Create</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `

    // Styles
    const style = document.createElement('style')
    style.textContent = `
      .wo-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
      .wo-header .title-area h2 { margin:0; color:#1f2937; }
      .wo-header .subtitle { margin:4px 0 0; color:#6b7280; font-size:13px; }
      .header-actions .btn { white-space:nowrap; }

      .wo-stats { display:grid; grid-template-columns: repeat(7, minmax(120px, 1fr)); gap:12px; margin-bottom:16px; }
      .stat-card { background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:12px; }
      .stat-title { font-size:12px; color:#6b7280; }
      .stat-value { font-size:22px; font-weight:700; color:#111827; }

      .wo-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
      .filters { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      .toolbar-actions { display:flex; gap:8px; }

      .form-control { width: 220px; padding: 8px 10px; border: 1px solid #d1d5db; border-radius:6px; font-size:14px; }
      #woSearch.form-control { width: 320px; }
      .btn { display:inline-flex; align-items:center; gap:6px; padding:8px 12px; border-radius:6px; border:1px solid #d1d5db; background:#fff; color:#111827; cursor:pointer; }
      .btn-primary { background:#2563eb; border-color:#2563eb; color:#fff; }
      .btn-secondary { background:#f3f4f6; }

      .table.wo-table { width:100%; border-collapse:collapse; }
      .table.wo-table thead th { text-align:left; font-weight:600; color:#374151; border-bottom:1px solid #e5e7eb; padding:10px; }
      .table.wo-table tbody td { border-bottom:1px solid #f3f4f6; padding:10px; color:#374151; vertical-align:top; }
      .muted { color:#6b7280; }
      .small { font-size:12px; }

      .status-chip { display:inline-block; padding:4px 8px; border-radius:999px; font-size:12px; font-weight:600; }
      .st-open { background:#e0e7ff; color:#3730a3; }
      .st-assigned { background:#e0f2fe; color:#075985; }
      .st-in_progress { background:#dbeafe; color:#1e40af; }
      .st-on_hold { background:#fee2e2; color:#991b1b; }
      .st-completed { background:#dcfce7; color:#166534; }
      .st-cancelled { background:#f3f4f6; color:#374151; }

      .prio-chip { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; border:1px solid; }
      .prio-low { border-color:#10b981; color:#065f46; }
      .prio-medium { border-color:#f59e0b; color:#92400e; }
      .prio-high { border-color:#ef4444; color:#991b1b; }

      .action-btn { border:none; background:transparent; color:#2563eb; cursor:pointer; padding:4px 6px; }
      .action-btn.danger { color:#b91c1c; }

      .modal { position:fixed; inset:0; background:rgba(0,0,0,.35); display:flex; align-items:center; justify-content:center; z-index:1000; }
      .modal-content { background:#fff; width:min(820px, 92vw); border-radius:10px; overflow:hidden; border:1px solid #e5e7eb; box-shadow:0 10px 30px rgba(0,0,0,.1); }
      .modal-header { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid #e5e7eb; }
      .modal-body { padding:16px; }
      .close-btn { cursor:pointer; font-size:22px; }
      .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
      .form-group { display:flex; flex-direction:column; gap:6px; }
      .form-group.full { grid-column: 1 / -1; }
      .modal-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
    `
    this.container.appendChild(style)
  }

  renderStatCardsPlaceholder() {
    return `
      ${this.statCard('Total', 'total')}
      ${this.statCard('Open', 'open')}
      ${this.statCard('Assigned', 'assigned')}
      ${this.statCard('In Progress', 'in_progress')}
      ${this.statCard('On Hold', 'on_hold')}
      ${this.statCard('Completed', 'completed')}
      ${this.statCard('Cancelled', 'cancelled')}
    `
  }

  statCard(label, key) {
    const val = this.stats[key] ?? 0
    return `
      <div class="stat-card">
        <div class="stat-title">${label}</div>
        <div class="stat-value">${val}</div>
      </div>
    `
  }

  attachEventListeners() {
    // Create + Modal controls
    const createBtn = this.container.querySelector('#createWOBtn')
    const modal = this.container.querySelector('#woModal')
    const closeModal = this.container.querySelector('#closeWOModal')
    const cancelBtn = this.container.querySelector('#cancelWOBtn')
    const form = this.container.querySelector('#woForm')

    if (createBtn)
      createBtn.addEventListener('click', () => this.openCreateModal())
    if (closeModal)
      closeModal.addEventListener('click', () => this.closeModal())
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeModal())
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModal()
      })
    }
    if (form) {
      form.addEventListener('submit', (e) => this.handleSubmit(e))
    }

    // Shutdown fields enable/disable
    const wasShutdownEl = this.container.querySelector('#woWasShutdown')
    const shutdownStartEl = this.container.querySelector('#woShutdownStart')
    const shutdownEndEl = this.container.querySelector('#woShutdownEnd')
    if (wasShutdownEl && shutdownStartEl && shutdownEndEl) {
      const syncShutdown = () => {
        const on = wasShutdownEl.checked
        shutdownStartEl.disabled = !on
        shutdownEndEl.disabled = !on
      }
      wasShutdownEl.addEventListener('change', syncShutdown)
      syncShutdown()
    }

    // Company change (superadmin)
    const companySel = this.container.querySelector('#woCompanySel')
    if (companySel) {
      companySel.addEventListener('change', async (e) => {
        this.selectedCompanyId = e.target.value ? Number(e.target.value) : null
        await this.loadMachines()
      })
    }

    // Filters
    const search = this.container.querySelector('#woSearch')
    const taskSel = this.container.querySelector('#woTask')
    const statSel = this.container.querySelector('#woStatus')
    const prioSel = this.container.querySelector('#woPriority')
    const refresh = this.container.querySelector('#refreshWOBtn')

    if (search) {
      search.addEventListener('input', (e) => {
        this.searchQuery = e.target.value
        this.offset = 0
        this.loadWorkOrders()
      })
    }
    if (taskSel) {
      taskSel.addEventListener('change', (e) => {
        this.filterTaskId = e.target.value
        this.offset = 0
        this.loadWorkOrders()
      })
    }
    if (statSel) {
      statSel.addEventListener('change', (e) => {
        this.filterStatus = e.target.value
        this.offset = 0
        this.loadWorkOrders()
      })
    }
    if (prioSel) {
      prioSel.addEventListener('change', (e) => {
        this.filterPriority = e.target.value
        this.offset = 0
        this.loadWorkOrders()
      })
    }
    if (refresh) {
      refresh.addEventListener('click', async () => {
        await this.refreshAll()
      })
    }
  }

  async refreshAll() {
    this.loading = true
    try {
      await Promise.all([this.loadStats(), this.loadWorkOrders()])
    } finally {
      this.loading = false
    }
  }

  async loadTasks() {
    try {
      const res = await this.getJson('/tasks?limit=200&offset=0')
      const items = Array.isArray(res) ? res : res && res.items ? res.items : []
      this.tasks = items
      // Fill both toolbar and modal selects
      const opts = ['<option value="">All Tasks</option>']
      items.forEach((t) => {
        opts.push(
          `<option value="${t.id}">${this.escape(
            t.title || t.name || 'Task #' + t.id
          )}</option>`
        )
      })
      const toolbarTask = this.container.querySelector('#woTask')
      if (toolbarTask) toolbarTask.innerHTML = opts.join('')

      const modalTask = this.container.querySelector('#woTaskSel')
      if (modalTask) {
        const mOpts = ['<option value="">Select Task</option>']
        items.forEach((t) => {
          mOpts.push(
            `<option value="${t.id}">${this.escape(
              t.title || t.name || 'Task #' + t.id
            )}</option>`
          )
        })
        modalTask.innerHTML = mOpts.join('')
      }
    } catch {
      // ignore
    }
  }

  async loadMe() {
    try {
      const res = await this.getJson('/auth/me')
      this.currentUser = res && res.user ? res.user : null
      const roles = (this.currentUser && this.currentUser.roles) || []
      this.isSuper = roles.some(
        (r) =>
          String(r.name).toLowerCase() === 'superadmin' &&
          String(r.scope).toLowerCase() === 'global'
      )
    } catch {
      this.currentUser = null
      this.isSuper = false
    }
  }

  async loadCompanies() {
    try {
      const res = await this.getJson('/companies')
      const items = Array.isArray(res) ? res : res && res.items ? res.items : []
      this.companies = items
      // populate modal select
      const sel = this.container.querySelector('#woCompanySel')
      const group = this.container.querySelector('#woCompanyGroup')
      if (sel) {
        const opts = ['<option value="">Select Company</option>']
        items.forEach((c) => {
          opts.push(
            `<option value="${c.id}">${this.escape(
              c.name || 'Company #' + c.id
            )}</option>`
          )
        })
        sel.innerHTML = opts.join('')
      }
      if (group) {
        group.style.display = this.isSuper ? 'block' : 'none'
      }
    } catch {
      // ignore
    }
  }

  async loadMachines() {
    try {
      const params = new URLSearchParams()
      if (this.isSuper && this.selectedCompanyId) {
        params.set('companyId', String(this.selectedCompanyId))
      }
      const res = await this.getJson(
        `/workorders/machines${
          params.toString() ? '?' + params.toString() : ''
        }`
      )
      const typeKey = res && res.typeKey ? res.typeKey : null
      const items = res && Array.isArray(res.items) ? res.items : []
      this.lastChildTypeKey = typeKey
      this.machines = items

      const modalMachine = this.container.querySelector('#woMachineSel')
      if (modalMachine) {
        const opts = ['<option value="">Select Machine</option>']
        items.forEach((m) => {
          const name = m.name != null ? String(m.name) : '#' + m.id
          opts.push(`<option value="${m.id}">${this.escape(name)}</option>`)
        })
        modalMachine.innerHTML = opts.join('')
      }
    } catch {
      // silently ignore
      this.machines = []
      this.lastChildTypeKey = null
    }
  }

  // Data loading
  async loadStats() {
    try {
      const stats = await this.getJson('/workorders/stats')
      this.stats = {
        total: stats.total || 0,
        open: stats.open || 0,
        assigned: stats.assigned || 0,
        in_progress: stats.in_progress || 0,
        on_hold: stats.on_hold || 0,
        completed: stats.completed || 0,
        cancelled: stats.cancelled || 0,
        high: stats.high || 0,
        medium: stats.medium || 0,
        low: stats.low || 0,
      }
      this.renderStats()
    } catch {
      // keep defaults
      this.renderStats()
    }
  }

  renderStats() {
    const holder = this.container.querySelector('#woStats')
    if (!holder) return
    holder.innerHTML = this.renderStatCardsPlaceholder()
  }

  async loadWorkOrders() {
    const params = new URLSearchParams()
    if (this.searchQuery) params.set('q', this.searchQuery)
    if (this.filterTaskId) params.set('taskId', this.filterTaskId)
    if (this.filterStatus) params.set('status', this.filterStatus)
    if (this.filterPriority) params.set('priority', this.filterPriority)
    params.set('limit', String(this.limit))
    params.set('offset', String(this.offset))

    try {
      const res = await this.getJson(`/workorders?${params.toString()}`)
      const items = Array.isArray(res) ? res : res && res.items ? res.items : []
      this.items = items
      this.renderTable()
    } catch {
      this.items = []
      this.renderTable()
    }
  }

  renderTable() {
    const tbody = this.container.querySelector('#woTbody')
    if (!tbody) return

    if (!this.items || this.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="muted">No work orders found.</td></tr>`
      return
    }

    tbody.innerHTML = this.items
      .map((wo) => {
        const statusChip = this.statusChip(wo.status)
        const prioChip = this.priorityChip(wo.priority)
        const due = wo.dueDate ? this.formatDate(wo.dueDate) : '-'
        const created = wo.createdAt ? this.formatDateTime(wo.createdAt) : '-'
        const taskTitle = wo.taskTitle || `#${wo.taskId}`

        return `
          <tr data-wo-id="${wo.id}">
            <td>
              <div class="row-title">${this.escape(wo.title)}</div>
              <div class="muted small">${this.escape(
                wo.description || ''
              )}</div>
            </td>
            <td>${this.escape(taskTitle)}</td>
            <td>${this.escape(
              wo.machineName ||
                (wo.machineRowId
                  ? '#' + wo.machineRowId
                  : wo.machineId
                  ? '#' + wo.machineId
                  : '-')
            )}</td>
            <td>${statusChip}</td>
            <td>${prioChip}</td>
            <td>${due}</td>
            <td>${wo.assignedTo ? '#' + wo.assignedTo : '-'}</td>
            <td>${created}</td>
            <td>
              <button class="action-btn" data-action="edit"><i class="fas fa-edit"></i></button>
              <button class="action-btn danger" data-action="delete"><i class="fas fa-trash"></i></button>
            </td>
          </tr>
        `
      })
      .join('')

    // Wire row action buttons
    tbody.querySelectorAll('tr').forEach((row) => {
      const id = parseInt(row.getAttribute('data-wo-id'))
      row.querySelectorAll('button[data-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const action = btn.getAttribute('data-action')
          const wo = this.items.find((x) => x.id === id)
          if (!wo) return
          if (action === 'edit') this.openEditModal(wo)
          if (action === 'delete') this.deleteWorkOrder(wo)
        })
      })
    })
  }

  statusChip(status) {
    const s = (status || '').toLowerCase()
    if (s === 'completed')
      return `<span class="status-chip st-completed">Completed</span>`
    if (s === 'open') return `<span class="status-chip st-open">Open</span>`
    if (s === 'assigned')
      return `<span class="status-chip st-assigned">Assigned</span>`
    if (s === 'on_hold')
      return `<span class="status-chip st-on_hold">On Hold</span>`
    if (s === 'in_progress')
      return `<span class="status-chip st-in_progress">In Progress</span>`
    if (s === 'cancelled')
      return `<span class="status-chip st-cancelled">Cancelled</span>`
    return `<span class="status-chip st-open">${this.escape(
      status || 'Open'
    )}</span>`
  }

  priorityChip(priority) {
    const p = (priority || '').toLowerCase()
    if (p === 'high') return `<span class="prio-chip prio-high">High</span>`
    if (p === 'low') return `<span class="prio-chip prio-low">Low</span>`
    return `<span class="prio-chip prio-medium">Medium</span>`
  }

  // Modal helpers
  openCreateModal() {
    this.editing = null
    this.fillModalFromData(null)
    this.openModal()
  }

  openEditModal(wo) {
    this.editing = wo
    this.fillModalFromData(wo)
    this.openModal(true)
  }

  fillModalFromData(wo) {
    const titleEl = this.container.querySelector('#woModalTitle')
    const submitText = this.container.querySelector('#woSubmitText')
    if (wo) {
      if (titleEl) titleEl.textContent = 'Edit Work Order'
      if (submitText) submitText.textContent = 'Update'
    } else {
      if (titleEl) titleEl.textContent = 'Create Work Order'
      if (submitText) submitText.textContent = 'Create'
    }

    // ensure tasks loaded in modal select
    const modalTask = this.container.querySelector('#woTaskSel')
    if (modalTask && modalTask.options.length <= 1 && this.tasks.length) {
      const mOpts = ['<option value="">Select Task</option>']
      this.tasks.forEach((t) => {
        mOpts.push(
          `<option value="${t.id}">${this.escape(
            t.title || t.name || 'Task #' + t.id
          )}</option>`
        )
      })
      modalTask.innerHTML = mOpts.join('')
    }

    const form = this.container.querySelector('#woForm')
    if (!form) return
    if (!wo) {
      form.reset()
      return
    }
    form.title.value = wo.title || ''
    form.taskId.value = wo.taskId || ''
    form.status.value = wo.status || 'open'
    form.priority.value = (wo.priority || 'medium').toLowerCase()
    form.dueDate.value = wo.dueDate ? this.toDateInput(wo.dueDate) : ''
    form.assignedTo.value = wo.assignedTo || ''
    form.description.value = wo.description || ''
    if (form.machineRowId) form.machineRowId.value = wo.machineRowId || ''
    // superadmin company preselect
    const companySel = this.container.querySelector('#woCompanySel')
    if (companySel && (this.isSuper || wo.companyId)) {
      const cid = this.isSuper
        ? this.selectedCompanyId || wo.companyId || ''
        : wo.companyId || ''
      companySel.value = cid || ''
    }
    if (form.wasShutdown) form.wasShutdown.checked = !!wo.wasShutdown
    if (form.shutdownStart)
      form.shutdownStart.value = wo.shutdownStart
        ? this.toDatetimeLocal(wo.shutdownStart)
        : ''
    if (form.shutdownEnd)
      form.shutdownEnd.value = wo.shutdownEnd
        ? this.toDatetimeLocal(wo.shutdownEnd)
        : ''
    // sync disabled state
    const wasShutdownEl = this.container.querySelector('#woWasShutdown')
    const shutdownStartEl = this.container.querySelector('#woShutdownStart')
    const shutdownEndEl = this.container.querySelector('#woShutdownEnd')
    if (wasShutdownEl && shutdownStartEl && shutdownEndEl) {
      const on = wasShutdownEl.checked
      shutdownStartEl.disabled = !on
      shutdownEndEl.disabled = !on
    }
  }

  openModal(isEdit = false) {
    const modal = this.container.querySelector('#woModal')
    if (modal) modal.style.display = 'flex'
  }
  closeModal() {
    const modal = this.container.querySelector('#woModal')
    if (modal) modal.style.display = 'none'
    const form = this.container.querySelector('#woForm')
    if (form) form.reset()
    this.editing = null
  }

  async handleSubmit(e) {
    e.preventDefault()
    const form = e.target
    const machineSel = form.machineRowId
    const selectedIdx = machineSel ? machineSel.selectedIndex : -1
    const selectedText =
      selectedIdx >= 0 && machineSel
        ? machineSel.options[selectedIdx].textContent.trim()
        : null

    const payload = {
      title: form.title.value.trim(),
      taskId: Number(form.taskId.value),
      status: form.status.value,
      priority: form.priority.value,
      dueDate: form.dueDate.value || null,
      assignedTo: form.assignedTo.value ? Number(form.assignedTo.value) : null,
      description: form.description.value,
      // Dynamic last-child reference
      machineTypeKey: this.lastChildTypeKey || null,
      machineRowId:
        machineSel && machineSel.value ? Number(machineSel.value) : null,
      machineName: selectedText || null,
      // Keep legacy field null
      machineId: null,
      wasShutdown: form.wasShutdown ? !!form.wasShutdown.checked : false,
      shutdownStart:
        form.shutdownStart && form.shutdownStart.value
          ? form.shutdownStart.value
          : null,
      shutdownEnd:
        form.shutdownEnd && form.shutdownEnd.value
          ? form.shutdownEnd.value
          : null,
    }

    // Include companyId when superadmin scoping is used
    if (this.isSuper) {
      payload.companyId =
        form.companyId && form.companyId.value
          ? Number(form.companyId.value)
          : null
    }

    if (!payload.title || !payload.taskId) {
      showToast('Please provide Title and Task', false)
      return
    }

    try {
      if (this.editing) {
        await this.putJson(`/workorders/${this.editing.id}`, payload)
        showToast('Work order updated')
      } else {
        await this.postJson('/workorders', payload)
        showToast('Work order created')
      }
      this.closeModal()
      await Promise.all([this.loadStats(), this.loadWorkOrders()])
    } catch (err) {
      const msg = err?.detail || err?.error || 'Failed to save work order'
      showToast(msg, false)
    }
  }

  async deleteWorkOrder(wo) {
    const ok = window.confirm(
      `Delete work order "${wo.title}"? This cannot be undone.`
    )
    if (!ok) return
    try {
      await this.deleteJson(`/workorders/${wo.id}`)
      showToast('Work order deleted')
      await Promise.all([this.loadStats(), this.loadWorkOrders()])
    } catch (err) {
      const msg = err?.detail || err?.error || 'Failed to delete work order'
      showToast(msg, false)
    }
  }

  // Utils
  toDateInput(d) {
    // Normalize to YYYY-MM-DD if possible
    try {
      const dt = new Date(d)
      if (isNaN(dt.getTime())) return ''
      const yyyy = dt.getFullYear()
      const mm = String(dt.getMonth() + 1).padStart(2, '0')
      const dd = String(dt.getDate()).padStart(2, '0')
      return `${yyyy}-${mm}-${dd}`
    } catch {
      return ''
    }
  }
  toDatetimeLocal(d) {
    // Normalize to YYYY-MM-DDTHH:mm for datetime-local inputs
    try {
      const dt = new Date(d)
      if (isNaN(dt.getTime())) return ''
      const yyyy = dt.getFullYear()
      const mm = String(dt.getMonth() + 1).padStart(2, '0')
      const dd = String(dt.getDate()).padStart(2, '0')
      const hh = String(dt.getHours()).padStart(2, '0')
      const mi = String(dt.getMinutes()).padStart(2, '0')
      return `${yyyy}-${mm}-${dd}T${hh}:${mi}`
    } catch {
      return ''
    }
  }
  formatDate(d) {
    try {
      const dt = new Date(d)
      if (isNaN(dt.getTime())) return this.escape(String(d))
      return dt.toLocaleDateString()
    } catch {
      return this.escape(String(d))
    }
  }
  formatDateTime(d) {
    try {
      const dt = new Date(d)
      if (isNaN(dt.getTime())) return this.escape(String(d))
      return dt.toLocaleString()
    } catch {
      return this.escape(String(d))
    }
  }
  escape(s) {
    const str = String(s)
    return str.replace(/[&<>"']/g, (c) => {
      switch (c) {
        case '&':
          return '&amp;'
        case '<':
          return '&lt;'
        case '>':
          return '&gt;'
        case '"':
          return '&quot;'
        case "'":
          return '&#39;'
        default:
          return c
      }
    })
  }

  // API helpers
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

  destroy() {
    this.container.innerHTML = ''
  }
}

// Expose
window.WorkOrdersComponent = WorkOrdersComponent

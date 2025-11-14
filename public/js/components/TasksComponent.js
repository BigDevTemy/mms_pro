/**
 * TasksComponent - Maintenance Task Management UI
 * - Stat cards for quick overview
 * - Filter/search toolbar
 * - Table list of tasks with status chips
 * - Create Task modal with category/frequency selectors
 * - Uses backend endpoints:
 *    GET  /tasks
 *    GET  /tasks/stats
 *    POST /tasks
 *    PUT  /tasks/{id}         (not wired in UI yet)
 *    DELETE /tasks/{id}       (not wired in UI yet)
 */
class TasksComponent {
  constructor(container) {
    this.container = container

    // State
    this.loading = false
    this.error = null

    // Data
    this.stats = {
      total: 0,
      pending: 0,
      in_progress: 0,
      completed: 0,
      electrical: 0,
      mechanical: 0,
      dueSoon: 0,
    }
    this.tasks = []

    // Filters
    this.searchQuery = ''
    this.filterCategory = ''
    this.filterFrequency = ''
    this.filterMaintType = ''
    this.filterStatus = ''
    this.limit = 20
    this.offset = 0

    // Modal state
    this.modalOpen = false

    this.init()
  }

  async init() {
    this.renderLayout()
    this.attachEventListeners()
    await this.refreshAll()
  }

  // Layout
  renderLayout() {
    this.container.innerHTML = `
      <div class="tasks-header">
        <div class="title-area">
          <h2><i class="fas fa-clipboard-check"></i> Maintenance Tasks</h2>
          <p class="subtitle">Create and track scheduled Electrical/Mechanical maintenance</p>
        </div>
        <div class="header-actions">
          <button id="createTaskBtn" class="btn btn-primary">
            <i class="fas fa-plus"></i> Create Task
          </button>
        </div>
      </div>

      <div class="tasks-stats" id="tasksStats">
        ${this.renderStatCardsPlaceholder()}
      </div>

      <div class="tasks-toolbar">
        <div class="filters">
          <input id="taskSearch" class="form-control" placeholder="Search tasks (title/description)..." />
          <select id="taskCategory" class="form-control">
            <option value="">All Categories</option>
            <option value="Electrical">Electrical</option>
            <option value="Mechanical">Mechanical</option>
          </select>
          <select id="taskFrequency" class="form-control">
            <option value="">All Frequencies</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          <select id="taskMaintType" class="form-control">
            <option value="">All Maint Types</option>
            <option value="Preventive">Preventive</option>
            <option value="Corrective">Corrective</option>
            <option value="Predictive">Predictive</option>
            <option value="Inspection">Inspection</option>
          </select>
          <select id="taskStatus" class="form-control">
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <div class="toolbar-actions">
          <button id="refreshTasksBtn" class="btn btn-secondary">
            <i class="fas fa-sync"></i> Refresh
          </button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="table tasks-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Category</th>
              <th>Frequency</th>
              <th>Maint Type</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Due</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody id="tasksTbody">
            <tr><td colspan="7" class="muted">No tasks yet.</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Create Task Modal -->
      <div class="modal" id="createTaskModal" style="display:none;">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Create Maintenance Task</h3>
            <span class="close-btn" id="closeCreateModal">&times;</span>
          </div>
          <div class="modal-body">
            <form id="createTaskForm">
              <div class="grid-2">
                <div class="form-group">
                  <label for="taskTitle">Title</label>
                  <input id="taskTitle" name="title" class="form-control" placeholder="e.g., Lubricate conveyor bearings" required />
                </div>
                <div class="form-group">
                  <label for="taskCategorySel">Category</label>
                  <select id="taskCategorySel" name="category" class="form-control" required>
                    <option value="">Select Category</option>
                    <option value="Electrical">Electrical</option>
                    <option value="Mechanical">Mechanical</option>
                  </select>
                </div>
                <div class="form-group">
                  <label for="taskFrequencySel">Frequency</label>
                  <select id="taskFrequencySel" name="frequency" class="form-control" required>
                    <option value="">Select Frequency</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div class="form-group">
                  <label for="taskMaintTypeSel">Maint Type</label>
                  <select id="taskMaintTypeSel" name="maintType" class="form-control" required>
                    <option value="Preventive" selected>Preventive</option>
                    <option value="Corrective">Corrective</option>
                    <option value="Predictive">Predictive</option>
                    <option value="Inspection">Inspection</option>
                  </select>
                </div>
                <div class="form-group">
                  <label for="taskPrioritySel">Priority</label>
                  <select id="taskPrioritySel" name="priority" class="form-control" required>
                    <option value="low">Low</option>
                    <option value="medium" selected>Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div class="form-group">
                  <label for="taskDueDate">Due Date (optional)</label>
                  <input id="taskDueDate" name="dueDate" class="form-control" type="date" />
                </div>
                <div class="form-group full">
                  <label for="taskDesc">Description</label>
                  <textarea id="taskDesc" name="description" class="form-control" rows="4" placeholder="Describe the maintenance steps..."></textarea>
                </div>
              </div>
              <div class="modal-actions">
                <button type="button" id="cancelCreateTask" class="btn">Cancel</button>
                <button type="submit" class="btn btn-primary">
                  <i class="fas fa-check"></i> Create Task
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `

    // Styles (scoped-ish)
    const style = document.createElement('style')
    style.textContent = `
      .tasks-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
      .tasks-header .title-area h2 { margin:0; color:#1f2937; }
      .tasks-header .subtitle { margin:4px 0 0; color:#6b7280; font-size:13px; }
      .header-actions .btn { white-space:nowrap; }

      .tasks-stats { display:grid; grid-template-columns: repeat(6, minmax(140px, 1fr)); gap:12px; margin-bottom:16px; }
      .stat-card { background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:12px; }
      .stat-title { font-size:12px; color:#6b7280; }
      .stat-value { font-size:22px; font-weight:700; color:#111827; }
      .stat-chip { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#374151; }
      .chip-electrical { color:#1d4ed8; }
      .chip-mechanical { color:#059669; }
      .chip-due { color:#b45309; }

      .tasks-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
      .filters { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      .toolbar-actions { display:flex; gap:8px; }

      .form-control { width: 220px; padding: 8px 10px; border: 1px solid #d1d5db; border-radius:6px; font-size:14px; }
      #taskSearch.form-control { width: 320px; }

      .btn { display:inline-flex; align-items:center; gap:6px; padding:8px 12px; border-radius:6px; border:1px solid #d1d5db; background:#fff; color:#111827; cursor:pointer; }
      .btn-primary { background:#2563eb; border-color:#2563eb; color:#fff; }
      .btn-secondary { background:#f3f4f6; }

      .table.tasks-table { width:100%; border-collapse:collapse; }
      .table.tasks-table thead th { text-align:left; font-weight:600; color:#374151; border-bottom:1px solid #e5e7eb; padding:10px; }
      .table.tasks-table tbody td { border-bottom:1px solid #f3f4f6; padding:10px; color:#374151; vertical-align:top; }
      .muted { color:#6b7280; }

      .status-chip { display:inline-block; padding:4px 8px; border-radius:999px; font-size:12px; font-weight:600; }
      .st-pending { background:#fef3c7; color:#92400e; }
      .st-in-progress { background:#dbeafe; color:#1e40af; }
      .st-completed { background:#dcfce7; color:#166534; }

      .prio-chip { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; border:1px solid; }
      .prio-low { border-color:#10b981; color:#065f46; }
      .prio-medium { border-color:#f59e0b; color:#92400e; }
      .prio-high { border-color:#ef4444; color:#991b1b; }

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
      ${this.statCard('Total Tasks', 'total')}
      ${this.statCard('Pending', 'pending')}
      ${this.statCard('In Progress', 'in_progress')}
      ${this.statCard('Completed', 'completed')}
      ${this.statCard('Electrical', 'electrical', 'chip-electrical')}
      ${this.statCard('Mechanical', 'mechanical', 'chip-mechanical')}
    `
  }

  statCard(label, key, extraClass = '') {
    const val = this.stats[key] ?? 0
    return `
      <div class="stat-card">
        <div class="stat-title">${label}</div>
        <div class="stat-value">${val}</div>
      </div>
    `
  }

  attachEventListeners() {
    // Create Task button and modal controls
    const createBtn = this.container.querySelector('#createTaskBtn')
    const modal = this.container.querySelector('#createTaskModal')
    const closeModal = this.container.querySelector('#closeCreateModal')
    const cancelBtn = this.container.querySelector('#cancelCreateTask')
    const form = this.container.querySelector('#createTaskForm')

    if (createBtn) createBtn.addEventListener('click', () => this.openModal())
    if (closeModal)
      closeModal.addEventListener('click', () => this.closeModal())
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeModal())
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModal()
      })
    }
    if (form) {
      form.addEventListener('submit', (e) => this.handleCreateSubmit(e))
    }

    // Filters
    const search = this.container.querySelector('#taskSearch')
    const cat = this.container.querySelector('#taskCategory')
    const freq = this.container.querySelector('#taskFrequency')
    const mtype = this.container.querySelector('#taskMaintType')
    const stat = this.container.querySelector('#taskStatus')
    const refresh = this.container.querySelector('#refreshTasksBtn')

    if (search) {
      search.addEventListener('input', (e) => {
        this.searchQuery = e.target.value
        this.offset = 0
        this.loadTasks()
      })
    }
    if (cat) {
      cat.addEventListener('change', (e) => {
        this.filterCategory = e.target.value
        this.offset = 0
        this.loadTasks()
      })
    }
    if (freq) {
      freq.addEventListener('change', (e) => {
        this.filterFrequency = e.target.value
        this.offset = 0
        this.loadTasks()
      })
    }
    if (mtype) {
      mtype.addEventListener('change', (e) => {
        this.filterMaintType = e.target.value
        this.offset = 0
        this.loadTasks()
      })
    }
    if (stat) {
      stat.addEventListener('change', (e) => {
        this.filterStatus = e.target.value
        this.offset = 0
        this.loadTasks()
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
      await Promise.all([this.loadStats(), this.loadTasks()])
    } finally {
      this.loading = false
    }
  }

  // Data loading
  async loadStats() {
    try {
      const qs = ''
      const stats = await this.getJson(`/tasks/stats${qs}`)
      this.stats = {
        total: stats.total || 0,
        pending: stats.pending || 0,
        in_progress: stats.in_progress || 0,
        completed: stats.completed || 0,
        electrical: stats.electrical || 0,
        mechanical: stats.mechanical || 0,
        dueSoon: stats.dueSoon || 0,
      }
      this.renderStats()
    } catch (e) {
      // silent; UI will show zeroes
    }
  }

  async loadTasks() {
    const params = new URLSearchParams()
    if (this.searchQuery) params.set('q', this.searchQuery)
    if (this.filterCategory) params.set('category', this.filterCategory)
    if (this.filterFrequency) params.set('frequency', this.filterFrequency)
    if (this.filterMaintType) params.set('maintType', this.filterMaintType)
    if (this.filterStatus) params.set('status', this.filterStatus)
    params.set('limit', String(this.limit))
    params.set('offset', String(this.offset))

    try {
      const res = await this.getJson(`/tasks?${params.toString()}`)
      const items = Array.isArray(res) ? res : res && res.items ? res.items : []
      this.tasks = items
      this.renderTable()
    } catch (e) {
      this.tasks = []
      this.renderTable()
    }
  }

  renderStats() {
    const holder = this.container.querySelector('#tasksStats')
    if (!holder) return
    holder.innerHTML = `
      ${this.statCard('Total Tasks', 'total')}
      ${this.statCard('Pending', 'pending')}
      ${this.statCard('In Progress', 'in_progress')}
      ${this.statCard('Completed', 'completed')}
      ${this.statCard('Electrical', 'electrical', 'chip-electrical')}
      ${this.statCard('Mechanical', 'mechanical', 'chip-mechanical')}
    `
  }

  renderTable() {
    const tbody = this.container.querySelector('#tasksTbody')
    if (!tbody) return

    if (!this.tasks || this.tasks.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted">No tasks found.</td></tr>`
      return
    }

    tbody.innerHTML = this.tasks
      .map((t) => {
        const statusChip = this.statusChip(t.status)
        const prioChip = this.priorityChip(t.priority)
        const due = t.dueDate ? this.formatDate(t.dueDate) : '-'
        const created = t.createdAt ? this.formatDateTime(t.createdAt) : '-'
        return `
          <tr>
            <td><div class="row-title">${this.escape(
              t.title
            )}</div><div class="muted small">${this.escape(
          t.description || ''
        )}</div></td>
            <td>${this.escape(t.category)}</td>
            <td>${this.escape(this.capitalize(t.frequency))}</td>
            <td>${this.escape(t.maintType || '-')}</td>
            <td>${prioChip}</td>
            <td>${statusChip}</td>
            <td>${due}</td>
            <td>${created}</td>
          </tr>
        `
      })
      .join('')
  }

  statusChip(status) {
    const s = (status || '').toLowerCase()
    if (s === 'completed')
      return `<span class="status-chip st-completed">Completed</span>`
    if (s === 'in_progress')
      return `<span class="status-chip st-in-progress">In&nbsp;Progress</span>`
    return `<span class="status-chip st-pending">Pending</span>`
  }

  priorityChip(priority) {
    const p = (priority || '').toLowerCase()
    if (p === 'high') return `<span class="prio-chip prio-high">High</span>`
    if (p === 'low') return `<span class="prio-chip prio-low">Low</span>`
    return `<span class="prio-chip prio-medium">Medium</span>`
  }

  // Modal helpers
  openModal() {
    const modal = this.container.querySelector('#createTaskModal')
    if (modal) modal.style.display = 'flex'
    this.modalOpen = true
  }
  closeModal() {
    const modal = this.container.querySelector('#createTaskModal')
    if (modal) modal.style.display = 'none'
    this.modalOpen = false
    const form = this.container.querySelector('#createTaskForm')
    if (form) form.reset()
  }

  async handleCreateSubmit(e) {
    e.preventDefault()
    const form = e.target
    const title = form.title.value.trim()
    const category = form.category.value
    const frequency = form.frequency.value
    const maintType = form.maintType.value
    const description = form.description.value
    const priority = form.priority.value
    const dueDate = form.dueDate.value

    if (!title || !category || !frequency || !maintType) {
      showToast('Please fill in required fields.', false)
      return
    }

    try {
      await this.postJson('/tasks', {
        title,
        category,
        frequency,
        maintType,
        description,
        priority,
        dueDate: dueDate || null,
      })
      showToast('Task created')
      this.closeModal()
      await Promise.all([this.loadStats(), this.loadTasks()])
    } catch (err) {
      showToast(err?.error || 'Failed to create task', false)
    }
  }

  // Utils
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
  capitalize(s) {
    if (!s) return ''
    return s.charAt(0).toUpperCase() + s.slice(1)
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

  destroy() {
    this.container.innerHTML = ''
  }
}

// Expose
window.TasksComponent = TasksComponent

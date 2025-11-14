class ReportsComponent {
  constructor(container) {
    this.container = container

    // State
    this.loading = false
    this.error = null
    this.items = [] // fetched work orders
    this.filteredItems = []

    // User context
    this.currentUser = null
    this.isSuper = false

    // Data for filters
    this.tasks = []
    this.companies = []

    // Filters
    this.searchQuery = ''
    this.filterCompanyId = null
    this.filterTaskId = ''
    this.filterStatus = ''
    this.filterPriority = ''
    this.filterAssignedTo = ''
    this.filterStartDate = ''
    this.filterEndDate = ''
    this.dateField = 'createdAt' // createdAt | dueDate | completedAt

    // Fetch paging
    this.pageSize = 200

    this.init()
  }

  async init() {
    this.renderLayout()
    this.attachEventListeners()

    // Load user / scope
    await this.loadMe()
    if (this.isSuper) {
      await this.loadCompanies()
    } else {
      // set default companyId from token for non-super users
      this.filterCompanyId = this.currentUser?.company_id || null
      const companySelect = this.container.querySelector('#repCompany')
      const companyGroup = this.container.querySelector('#repCompanyGroup')
      if (companyGroup) companyGroup.style.display = 'none'
      if (companySelect) companySelect.value = ''
    }

    await this.loadTasks()

    // initial load
    await this.refresh()
  }

  renderLayout() {
    this.container.innerHTML = `
      <div class="rep-header">
        <div class="title-area">
          <h2><i class="fas fa-chart-bar"></i> Reports</h2>
          <p class="subtitle">Analyze work orders with powerful filters and export data to Excel</p>
        </div>
        <div class="header-actions">
          <button id="repRefreshBtn" class="btn btn-secondary">
            <i class="fas fa-sync"></i> Refresh
          </button>
          <button id="repExportCsvBtn" class="btn">
            <i class="fas fa-file-csv"></i> Export CSV
          </button>
          <button id="repExportXlsxBtn" class="btn btn-primary">
            <i class="fas fa-file-excel"></i> Export Excel
          </button>
        </div>
      </div>

      <div class="rep-filters">
        <div class="row">
          <div class="form-group" id="repCompanyGroup" style="display:none;">
            <label for="repCompany">Company</label>
            <select id="repCompany" class="form-control">
              <option value="">All Companies</option>
            </select>
          </div>

          <div class="form-group">
            <label for="repTask">Task</label>
            <select id="repTask" class="form-control">
              <option value="">All Tasks</option>
            </select>
          </div>

          <div class="form-group">
            <label for="repStatus">Status</label>
            <select id="repStatus" class="form-control">
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="assigned">Assigned</option>
              <option value="in_progress">In Progress</option>
              <option value="on_hold">On Hold</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div class="form-group">
            <label for="repPriority">Priority</label>
            <select id="repPriority" class="form-control">
              <option value="">All</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          <div class="form-group">
            <label for="repAssignedTo">Assigned To (User ID)</label>
            <input id="repAssignedTo" class="form-control" type="number" min="1" placeholder="e.g., 42" />
          </div>

          <div class="form-group">
            <label for="repDateField">Date Field</label>
            <select id="repDateField" class="form-control">
              <option value="createdAt">Created</option>
              <option value="dueDate">Due</option>
              <option value="completedAt">Completed</option>
            </select>
          </div>

          <div class="form-group">
            <label for="repStartDate">Start Date</label>
            <input id="repStartDate" class="form-control" type="date" />
          </div>

          <div class="form-group">
            <label for="repEndDate">End Date</label>
            <input id="repEndDate" class="form-control" type="date" />
          </div>

          <div class="form-group full">
            <label for="repSearch">Search</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <input id="repSearch" class="form-control" placeholder="Search titles/descriptions..." />
              <button id="repSearchBtn" type="button" class="btn btn-primary">
                <i class="fas fa-search"></i> Search
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="rep-summary" id="repSummary">
        ${this.renderSummaryPlaceholder()}
      </div>

      <div class="table-responsive">
        <table class="table rep-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Task</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Machine</th>
              <th>Assigned To</th>
              <th>Created</th>
              <th>Due</th>
              <th>Completed</th>
              <th>Company</th>
            </tr>
          </thead>
          <tbody id="repTbody">
            <tr><td colspan="11" class="muted">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    `

    // Local styles
    const style = document.createElement('style')
    style.textContent = `
      .rep-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
      .rep-header .subtitle { margin:4px 0 0; color:#6b7280; font-size:13px; }
      .header-actions .btn { margin-left:8px; }

      .rep-filters { background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:12px; margin-bottom:12px; }
      .rep-filters .row { display:grid; grid-template-columns: repeat(4, 1fr); grid-gap:12px; }
      .rep-filters .form-group.full { grid-column: 1 / -1; }

      .rep-summary { display:grid; grid-template-columns: repeat(6, minmax(140px, 1fr)); gap:12px; margin: 12px 0; }
      .sum-card { background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:12px; }
      .sum-title { color:#6b7280; font-size:12px; }
      .sum-value { color:#111827; font-size:20px; font-weight:700; }

      .table.rep-table thead th { text-align:left; font-weight:600; color:#374151; border-bottom:1px solid #e5e7eb; padding:10px; }
      .table.rep-table tbody td { border-bottom:1px solid #f3f4f6; padding:8px 10px; color:#374151; vertical-align:top; }
      .muted { color:#6b7280; }
      @media (max-width: 1024px) {
        .rep-filters .row { grid-template-columns: repeat(2, 1fr); }
        .rep-summary { grid-template-columns: repeat(3, 1fr); }
      }
      @media (max-width: 640px) {
        .rep-filters .row { grid-template-columns: 1fr; }
        .rep-summary { grid-template-columns: 1fr; }
      }
    `
    this.container.appendChild(style)
  }

  renderSummaryPlaceholder() {
    return `
      ${this.sumCard('Total', 0)}
      ${this.sumCard('Open', 0)}
      ${this.sumCard('Assigned', 0)}
      ${this.sumCard('In Progress', 0)}
      ${this.sumCard('On Hold', 0)}
      ${this.sumCard('Completed', 0)}
    `
  }

  sumCard(title, val) {
    return `
      <div class="sum-card">
        <div class="sum-title">${title}</div>
        <div class="sum-value">${val}</div>
      </div>
    `
  }

  attachEventListeners() {
    // Refresh
    const refreshBtn = this.container.querySelector('#repRefreshBtn')
    if (refreshBtn) refreshBtn.addEventListener('click', () => this.refresh())

    // Export
    const exportCsvBtn = this.container.querySelector('#repExportCsvBtn')
    if (exportCsvBtn)
      exportCsvBtn.addEventListener('click', () => this.exportCSV())

    const exportXlsxBtn = this.container.querySelector('#repExportXlsxBtn')
    if (exportXlsxBtn)
      exportXlsxBtn.addEventListener('click', () => this.exportXLSX())

    // Filters
    const company = this.container.querySelector('#repCompany')
    if (company)
      company.addEventListener('change', () => {
        this.filterCompanyId = company.value ? Number(company.value) : null
      })

    const task = this.container.querySelector('#repTask')
    if (task)
      task.addEventListener('change', () => {
        this.filterTaskId = task.value
      })

    const status = this.container.querySelector('#repStatus')
    if (status)
      status.addEventListener('change', () => {
        this.filterStatus = status.value
      })

    const prio = this.container.querySelector('#repPriority')
    if (prio)
      prio.addEventListener('change', () => {
        this.filterPriority = prio.value
      })

    const assigned = this.container.querySelector('#repAssignedTo')
    if (assigned)
      assigned.addEventListener('input', () => {
        this.filterAssignedTo = assigned.value
      })

    const search = this.container.querySelector('#repSearch')
    if (search) {
      search.addEventListener('input', () => {
        this.searchQuery = search.value
      })
      // Allow pressing Enter in the search box to trigger the Search button
      search.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          const btn = this.container.querySelector('#repSearchBtn')
          if (btn) btn.click()
        }
      })
    }

    const df = this.container.querySelector('#repDateField')
    if (df)
      df.addEventListener('change', () => {
        this.dateField = df.value
      })

    const sd = this.container.querySelector('#repStartDate')
    if (sd)
      sd.addEventListener('change', () => {
        this.filterStartDate = sd.value
      })

    const ed = this.container.querySelector('#repEndDate')
    if (ed)
      ed.addEventListener('change', () => {
        this.filterEndDate = ed.value
      })
    // Triggered search apply
    const searchBtn = this.container.querySelector('#repSearchBtn')
    if (searchBtn) {
      searchBtn.addEventListener('click', () => this.refresh())
    }
  }

  async refresh() {
    try {
      this.loading = true
      await this.fetchAllWorkOrders()
      this.applyFilters()
      this.renderSummary()
      this.renderTable()
      showToast('Report refreshed')
    } catch (e) {
      this.items = []
      this.filteredItems = []
      this.renderSummary()
      this.renderTable()
      showToast(e?.error || 'Failed to load report', false)
    } finally {
      this.loading = false
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
      const group = this.container.querySelector('#repCompanyGroup')
      if (group) group.style.display = this.isSuper ? 'block' : 'none'
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
      const sel = this.container.querySelector('#repCompany')
      if (sel) {
        const opts = ['<option value="">All Companies</option>']
        items.forEach((c) => {
          opts.push(
            `<option value="${c.id}">${this.escape(
              c.name || 'Company #' + c.id
            )}</option>`
          )
        })
        sel.innerHTML = opts.join('')
      }
    } catch {
      /* ignore */
    }
  }

  async loadTasks() {
    try {
      const res = await this.getJson('/tasks?limit=200&offset=0')
      const items = Array.isArray(res) ? res : res && res.items ? res.items : []
      this.tasks = items
      const sel = this.container.querySelector('#repTask')
      if (sel) {
        const opts = ['<option value="">All Tasks</option>']
        items.forEach((t) => {
          const name = t.title || t.name || 'Task #' + t.id
          opts.push(`<option value="${t.id}">${this.escape(name)}</option>`)
        })
        sel.innerHTML = opts.join('')
      }
    } catch {
      /* ignore */
    }
  }

  async fetchAllWorkOrders() {
    // Page through all results based on server pagination
    const collected = []
    let offset = 0
    const limit = this.pageSize

    const baseParams = new URLSearchParams()
    baseParams.set('limit', String(limit))
    if (this.filterTaskId) baseParams.set('taskId', String(this.filterTaskId))
    if (this.filterStatus) baseParams.set('status', String(this.filterStatus))
    if (this.filterPriority)
      baseParams.set('priority', String(this.filterPriority))
    if (this.searchQuery) baseParams.set('q', String(this.searchQuery))
    if (this.filterAssignedTo)
      baseParams.set('assignedTo', String(this.filterAssignedTo))
    if (this.isSuper && this.filterCompanyId)
      baseParams.set('companyId', String(this.filterCompanyId))

    while (true) {
      baseParams.set('offset', String(offset))
      const res = await this.getJson(`/workorders?${baseParams.toString()}`)
      const items = Array.isArray(res) ? res : res && res.items ? res.items : []
      collected.push(...items)
      if (!Array.isArray(items) || items.length < limit) break
      offset += limit
      // Safety guard to prevent runaway
      if (offset > 5000) break
    }

    this.items = collected
  }

  applyFilters() {
    // Additional client-side date filtering (createdAt/dueDate/completedAt)
    const startMs = this.filterStartDate
      ? new Date(this.filterStartDate).getTime()
      : null
    const endMs = this.filterEndDate
      ? new Date(this.filterEndDate).getTime()
      : null

    const fieldMap = {
      createdAt: 'createdAt',
      dueDate: 'dueDate',
      completedAt: 'completedAt',
    }
    const field = fieldMap[this.dateField] || 'createdAt'

    const fit = this.items.filter((it) => {
      // Date filtering
      if (startMs || endMs) {
        const raw = it[field] || null
        if (raw) {
          const t = new Date(raw).getTime()
          if (!isNaN(t)) {
            if (startMs && t < startMs) return false
            if (endMs && t > endMs + (24 * 60 * 60 * 1000 - 1)) return false // end of day
          }
        } else {
          // if no date, and user set a filter, omit
          return false
        }
      }
      return true
    })

    this.filteredItems = fit
  }

  renderSummary() {
    const items = this.filteredItems
    const getCount = (st) =>
      items.filter((x) => String(x.status || '').toLowerCase() === st).length

    const total = items.length
    const open = getCount('open')
    const assigned = getCount('assigned')
    const inprog = getCount('in_progress')
    const onhold = getCount('on_hold')
    const completed = getCount('completed')

    const holder = this.container.querySelector('#repSummary')
    if (!holder) return
    holder.innerHTML = `
      ${this.sumCard('Total', total)}
      ${this.sumCard('Open', open)}
      ${this.sumCard('Assigned', assigned)}
      ${this.sumCard('In Progress', inprog)}
      ${this.sumCard('On Hold', onhold)}
      ${this.sumCard('Completed', completed)}
    `
  }

  renderTable() {
    const tbody = this.container.querySelector('#repTbody')
    if (!tbody) return

    const items = this.filteredItems
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" class="muted">No data found for current filters.</td></tr>`
      return
    }

    tbody.innerHTML = items
      .map((wo) => {
        const taskTitle = wo.taskTitle || (wo.taskId ? '#' + wo.taskId : '-')
        const machine =
          wo.machineName ||
          (wo.machineRowId
            ? '#' + wo.machineRowId
            : wo.machineId
            ? '#' + wo.machineId
            : '-')
        const created = wo.createdAt ? this.formatDateTime(wo.createdAt) : '-'
        const due = wo.dueDate ? this.formatDate(wo.dueDate) : '-'
        const comp = wo.completedAt ? this.formatDateTime(wo.completedAt) : '-'
        const company = wo.companyId != null ? '#' + wo.companyId : '-'

        return `
        <tr>
          <td>${wo.id}</td>
          <td>${this.escape(wo.title || '')}</td>
          <td>${this.escape(taskTitle)}</td>
          <td>${this.escape(wo.status || '')}</td>
          <td>${this.escape(wo.priority || '')}</td>
          <td>${this.escape(machine)}</td>
          <td>${wo.assignedTo ? '#' + wo.assignedTo : '-'}</td>
          <td>${created}</td>
          <td>${due}</td>
          <td>${comp}</td>
          <td>${company}</td>
        </tr>
      `
      })
      .join('')
  }

  // Export helpers
  exportCSV() {
    const rows = this.getExportRows()
    if (rows.length === 0) {
      showToast('Nothing to export', false)
      return
    }
    const header = Object.keys(rows[0])
    const csv = [
      header.join(','),
      ...rows.map((r) => header.map((k) => this.csvEscape(r[k])).join(',')),
    ].join('\r\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    a.href = url
    a.download = `workorders-report-${ts}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async exportXLSX() {
    const rows = this.getExportRows()
    if (rows.length === 0) {
      showToast('Nothing to export', false)
      return
    }

    // Lazy-load SheetJS if not present
    if (typeof window.XLSX === 'undefined') {
      try {
        await this.loadScript(
          'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
        )
      } catch (e) {
        showToast('Failed to load Excel exporter', false)
        return
      }
    }

    try {
      const header = Object.keys(rows[0])
      const data = [header, ...rows.map((r) => header.map((k) => r[k]))]
      const ws = window.XLSX.utils.aoa_to_sheet(data)
      const wb = window.XLSX.utils.book_new()
      window.XLSX.utils.book_append_sheet(wb, ws, 'WorkOrders')

      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      window.XLSX.writeFile(wb, `workorders-report-${ts}.xlsx`)
    } catch (e) {
      showToast('Failed to export Excel', false)
    }
  }

  getExportRows() {
    const items = this.filteredItems
    return items.map((wo) => ({
      id: wo.id,
      title: wo.title || '',
      taskTitle: wo.taskTitle || (wo.taskId ? '#' + wo.taskId : ''),
      status: wo.status || '',
      priority: wo.priority || '',
      machine:
        wo.machineName ||
        (wo.machineRowId
          ? '#' + wo.machineRowId
          : wo.machineId
          ? '#' + wo.machineId
          : ''),
      assignedTo: wo.assignedTo || '',
      createdAt: wo.createdAt || '',
      dueDate: wo.dueDate || '',
      startedAt: wo.startedAt || '',
      completedAt: wo.completedAt || '',
      companyId: wo.companyId != null ? wo.companyId : '',
    }))
  }

  csvEscape(v) {
    if (v == null) return ''
    const s = String(v)
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }

  async loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = src
      s.onload = resolve
      s.onerror = reject
      document.head.appendChild(s)
    })
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

  escape(s) {
    const str = String(s)
    return str.replace(/[&<>"']/g, (c) => {
      switch (c) {
        case '&':
          return '&'
        case '<':
          return '<'
        case '>':
          return '>'
        case '"':
          return '"'
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

  destroy() {
    this.container.innerHTML = ''
  }
}

// Expose
window.ReportsComponent = ReportsComponent

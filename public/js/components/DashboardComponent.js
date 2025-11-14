class DashboardComponent {
  constructor(container) {
    this.container = container
    this.charts = {}
    this.init()
  }

  init() {
    this.render()
    this.initCharts()
    this.loadData()
    this.setupAutoRefresh()
  }

  render() {
    this.container.innerHTML = `
      <div class="dashboard-grid">
        <!-- Stats Cards -->
        <div class="stat-card">
          <div class="card-header">
            <span>System Uptime</span>
            <i class="fas fa-server icon-blue"></i>
          </div>
          <div class="card-value" id="uptimeValue">99.9%</div>
          <div class="card-trend up">
            <i class="fas fa-arrow-up"></i> 2.5%
          </div>
        </div>

        <div class="stat-card">
          <div class="card-header">
            <span>Active Assets</span>
            <i class="fas fa-tools icon-green"></i>
          </div>
          <div class="card-value" id="activeAssetsCount">0</div>
          <div class="card-trend up">
            <i class="fas fa-arrow-up"></i> 15%
          </div>
        </div>

        <div class="stat-card">
          <div class="card-header">
            <span>Maintenance Due</span>
            <i class="fas fa-calendar-alt icon-yellow"></i>
          </div>
          <div class="card-value" id="maintenanceDueCount">0</div>
          <div class="card-trend down">
            <i class="fas fa-arrow-down"></i> 5%
          </div>
        </div>

        <!-- Charts Row -->
        <div class="chart-card">
          <div class="card-header">
            <h3>System Uptime</h3>
            <div class="time-filters">
              <button class="btn-time active" data-period="24h">24h</button>
              <button class="btn-time" data-period="7d">7d</button>
              <button class="btn-time" data-period="30d">30d</button>
            </div>
          </div>
          <div class="chart-container">
            <canvas id="uptimeChart"></canvas>
          </div>
        </div>

        <div class="chart-card">
          <div class="card-header">
            <h3>Asset Health</h3>
            <button class="btn-refresh" id="refreshHealthChart">
              <i class="fas fa-sync-alt"></i>
            </button>
          </div>
          <div class="chart-container">
            <canvas id="assetHealthChart"></canvas>
          </div>
        </div>

        <!-- Tables Row -->
        <div class="info-card">
          <div class="info-card-header">
            <h3><i class="fas fa-bell"></i> Recent Alerts</h3>
            <button class="btn-view-all" id="viewAllAlerts">View All</button>
          </div>
          <div class="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Alert Type</th>
                  <th>Status</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody id="recentAlerts">
                <tr><td colspan="4" class="loading">Loading alerts...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="info-card full-width">
          <div class="info-card-header">
            <h3><i class="fas fa-tasks"></i> Pending Tasks</h3>
            <button class="btn-view-all" id="viewAllTasks">View All</button>
          </div>
          <div class="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Assigned To</th>
                  <th>Due Date</th>
                  <th>Priority</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody id="pendingTasks">
                <tr><td colspan="5" class="loading">Loading tasks...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `

    this.attachEventListeners()
  }

  attachEventListeners() {
    // Time filter buttons
    const timeButtons = this.container.querySelectorAll('.btn-time')
    timeButtons.forEach((button) => {
      button.addEventListener('click', (e) => {
        timeButtons.forEach((btn) => btn.classList.remove('active'))
        e.target.classList.add('active')
        this.updateUptimeChart(e.target.dataset.period)
      })
    })

    // Refresh health chart
    const refreshBtn = this.container.querySelector('#refreshHealthChart')
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.refreshHealthChart())
    }

    // View all buttons
    const viewAllAlerts = this.container.querySelector('#viewAllAlerts')
    const viewAllTasks = this.container.querySelector('#viewAllTasks')

    if (viewAllAlerts) {
      viewAllAlerts.addEventListener('click', () => this.viewAllAlerts())
    }

    if (viewAllTasks) {
      viewAllTasks.addEventListener('click', () => this.viewAllTasks())
    }
  }

  initCharts() {
    this.initUptimeChart()
    this.initAssetHealthChart()
  }

  initUptimeChart() {
    const ctx = this.container.querySelector('#uptimeChart').getContext('2d')
    const gradient = ctx.createLinearGradient(0, 0, 0, 300)
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.2)')
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.05)')

    this.charts.uptime = new Chart(ctx, {
      type: 'line',
      data: {
        labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
        datasets: [
          {
            label: 'Uptime %',
            data: Array.from(
              { length: 24 },
              () => Math.floor(Math.random() * 5) + 95
            ),
            borderColor: '#3b82f6',
            backgroundColor: gradient,
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointBackgroundColor: '#ffffff',
            pointBorderColor: '#3b82f6',
            pointBorderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          y: {
            beginAtZero: false,
            min: 90,
            max: 100,
            grid: { color: 'rgba(0, 0, 0, 0.05)' },
            ticks: { color: '#6b7280' },
          },
          x: {
            grid: { display: false },
            ticks: { color: '#6b7280' },
          },
        },
      },
    })
  }

  initAssetHealthChart() {
    const ctx = this.container
      .querySelector('#assetHealthChart')
      .getContext('2d')
    this.charts.health = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Healthy', 'Warning', 'Critical'],
        datasets: [
          {
            data: [85, 10, 5],
            backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
            borderWidth: 0,
            hoverOffset: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { padding: 20, usePointStyle: true },
          },
        },
      },
    })
  }

  async loadData() {
    try {
      await Promise.all([
        this.loadStats(),
        this.loadRecentAlerts(),
        this.loadPendingTasks(),
      ])
    } catch (error) {
      console.error('Error loading dashboard data:', error)
      showToast('Failed to load dashboard data', false)
    }
  }

  async loadStats() {
    try {
      // Load active assets count
      const assets = await getJson('/assets?status=active')
      const activeAssetsEl = this.container.querySelector('#activeAssetsCount')
      if (activeAssetsEl) {
        activeAssetsEl.textContent = assets.length || 0
      }

      // Load maintenance due count
      const maintenanceDue = await getJson('/maintenance/due')
      const maintenanceEl = this.container.querySelector('#maintenanceDueCount')
      if (maintenanceEl) {
        maintenanceEl.textContent = maintenanceDue.length || 0
      }
    } catch (error) {
      console.error('Error loading stats:', error)
    }
  }

  async loadRecentAlerts() {
    try {
      const alerts = await getJson('/alerts?limit=5')
      const tbody = this.container.querySelector('#recentAlerts')
      if (!tbody) return

      tbody.innerHTML = ''

      if (alerts.length === 0) {
        tbody.innerHTML =
          '<tr><td colspan="4" class="no-data">No recent alerts</td></tr>'
        return
      }

      alerts.forEach((alert) => {
        const row = document.createElement('tr')
        row.innerHTML = `
          <td>${alert.assetName || 'N/A'}</td>
          <td><span class="badge ${this.getAlertBadgeClass(alert.type)}">${
          alert.type
        }</span></td>
          <td>${alert.status}</td>
          <td>${new Date(alert.timestamp).toLocaleString()}</td>
        `
        tbody.appendChild(row)
      })
    } catch (error) {
      console.error('Error loading recent alerts:', error)
      const tbody = this.container.querySelector('#recentAlerts')
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="4" class="error">Failed to load alerts</td></tr>'
      }
    }
  }

  async loadPendingTasks() {
    try {
      const tasks = await getJson('/tasks?status=pending&limit=5')
      const tbody = this.container.querySelector('#pendingTasks')
      if (!tbody) return

      tbody.innerHTML = ''

      if (tasks.length === 0) {
        tbody.innerHTML =
          '<tr><td colspan="5" class="no-data">No pending tasks</td></tr>'
        return
      }

      tasks.forEach((task) => {
        const row = document.createElement('tr')
        row.innerHTML = `
          <td>${task.title}</td>
          <td>${task.assignedTo || 'Unassigned'}</td>
          <td>${new Date(task.dueDate).toLocaleDateString()}</td>
          <td><span class="badge ${this.getPriorityBadgeClass(
            task.priority
          )}">${task.priority}</span></td>
          <td><span class="status ${task.status.toLowerCase()}">${
          task.status
        }</span></td>
        `
        tbody.appendChild(row)
      })
    } catch (error) {
      console.error('Error loading pending tasks:', error)
      const tbody = this.container.querySelector('#pendingTasks')
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="5" class="error">Failed to load tasks</td></tr>'
      }
    }
  }

  getAlertBadgeClass(alertType) {
    const types = {
      critical: 'badge-danger',
      warning: 'badge-warning',
      info: 'badge-info',
      success: 'badge-success',
    }
    return types[alertType.toLowerCase()] || 'badge-secondary'
  }

  getPriorityBadgeClass(priority) {
    const priorities = {
      high: 'badge-danger',
      medium: 'badge-warning',
      low: 'badge-info',
    }
    return priorities[priority.toLowerCase()] || 'badge-secondary'
  }

  updateUptimeChart(period) {
    // Update chart data based on selected period
    const dataPoints = period === '24h' ? 24 : period === '7d' ? 7 : 30
    const newData = Array.from(
      { length: dataPoints },
      () => Math.floor(Math.random() * 5) + 95
    )

    this.charts.uptime.data.labels = Array.from(
      { length: dataPoints },
      (_, i) => {
        if (period === '24h') return `${i}:00`
        if (period === '7d') return `Day ${i + 1}`
        return `Week ${i + 1}`
      }
    )

    this.charts.uptime.data.datasets[0].data = newData
    this.charts.uptime.update()
  }

  refreshHealthChart() {
    // Simulate refreshing health data
    const newData = [
      Math.floor(Math.random() * 10) + 80, // Healthy
      Math.floor(Math.random() * 10) + 5, // Warning
      Math.floor(Math.random() * 5) + 1, // Critical
    ]

    this.charts.health.data.datasets[0].data = newData
    this.charts.health.update()

    showToast('Health chart refreshed')
  }

  viewAllAlerts() {
    // Navigate to alerts page or open modal
    showToast('View all alerts - feature coming soon')
  }

  viewAllTasks() {
    // Navigate to tasks page or open modal
    showToast('View all tasks - feature coming soon')
  }

  setupAutoRefresh() {
    // Auto-refresh data every 5 minutes
    setInterval(() => {
      this.loadData()
    }, 300000)
  }

  destroy() {
    // Clean up charts
    Object.values(this.charts).forEach((chart) => {
      if (chart) chart.destroy()
    })
    this.charts = {}
  }
}

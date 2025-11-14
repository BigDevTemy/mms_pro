/**
 * Lightweight placeholder components to keep SPA navigation smooth
 * until backend wiring and detailed UIs are ready.
 * Exposes:
 *  - UsersComponent
 *  - AssetsComponent
 *  - ReportsComponent
 *  - SettingsComponent
 */

class UsersPlaceholderComponent {
  constructor(container) {
    this.container = container
    this.render()
  }

  render() {
    this.container.innerHTML = `
      <div class="info-card full-width">
        <div class="info-card-header">
          <h3><i class="fas fa-users"></i> Users</h3>
          <button class="btn-view-all" disabled>View All</button>
        </div>
        <div class="info-card-body">
          <p style="color:#6b7280;">User management UI is coming soon.</p>
          <div class="table-responsive" style="margin-top:1rem;">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr><td colspan="3" class="no-data">No data yet</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `
  }

  destroy() {
    this.container.innerHTML = ''
  }
}

class AssetsComponent {
  constructor(container) {
    this.container = container
    this.render()
  }

  render() {
    this.container.innerHTML = `
      <div class="info-card full-width">
        <div class="info-card-header">
          <h3><i class="fas fa-tools"></i> Assets</h3>
          <button class="btn-view-all" disabled>View All</button>
        </div>
        <div class="info-card-body">
          <p style="color:#6b7280;">Assets inventory and health will appear here.</p>
          <div class="alerts-list" style="margin-top:1rem;">
            <div class="alert-item">
              <div class="alert-icon info"><i class="fas fa-info"></i></div>
              <div class="alert-content">
                <h4>Coming soon</h4>
                <p>Track asset lifecycle, maintenance, and assignments.</p>
                <div class="alert-time">Placeholder</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `
  }

  destroy() {
    this.container.innerHTML = ''
  }
}

class ReportsPlaceholderComponent {
  constructor(container) {
    this.container = container
    this.render()
  }

  render() {
    this.container.innerHTML = `
      <div class="info-card full-width">
        <div class="info-card-header">
          <h3><i class="fas fa-chart-bar"></i> Reports</h3>
          <button class="btn-view-all" disabled>Export</button>
        </div>
        <div class="info-card-body">
          <p style="color:#6b7280;">Analytics and performance reports will be available here.</p>
          <div class="dashboard-grid" style="margin-top:1rem;">
            <div class="stat-card">
              <div class="card-header"><span>MTBF</span><i class="fas fa-stopwatch icon-blue"></i></div>
              <div class="card-value">—</div>
            </div>
            <div class="stat-card">
              <div class="card-header"><span>MTTR</span><i class="fas fa-wrench icon-green"></i></div>
              <div class="card-value">—</div>
            </div>
          </div>
        </div>
      </div>
    `
  }

  destroy() {
    this.container.innerHTML = ''
  }
}

class SettingsComponent {
  constructor(container) {
    this.container = container
    this.render()
  }

  render() {
    this.container.innerHTML = `
      <div class="info-card full-width">
        <div class="info-card-header">
          <h3><i class="fas fa-cog"></i> Settings</h3>
          <button class="btn-view-all" disabled>Save</button>
        </div>
        <div class="info-card-body">
          <p style="color:#6b7280;">Application and company settings will be configurable here.</p>
          <div style="margin-top:1rem;">
            <div class="form-group">
              <label>Company Name</label>
              <input disabled placeholder="Acme Ltd" />
            </div>
            <div class="form-group">
              <label>Timezone</label>
              <select disabled><option>UTC</option></select>
            </div>
          </div>
        </div>
      </div>
    `
  }

  destroy() {
    this.container.innerHTML = ''
  }
}

// Expose placeholders globally so app.js can resolve constructors by name
if (typeof window !== 'undefined') {
  // Do not assign UsersComponent placeholder; the real Users module provides window.UsersComponent
  window.AssetsComponent = window.AssetsComponent || AssetsComponent
  window.ReportsComponent =
    window.ReportsComponent || ReportsPlaceholderComponent
  window.SettingsComponent = window.SettingsComponent || SettingsComponent
}

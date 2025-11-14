// Initialize components when DOM is fully loaded
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM fully loaded, initializing components...');
  
  // Initialize company component if available
  if (typeof CompanyComponent !== 'undefined') {
    console.log('Initializing CompanyComponent...');
    window.companyComponent = new CompanyComponent();
  }
  
  // Initialize sidebar if the script is loaded
  if (typeof sidebar !== 'undefined') {
    console.log('Initializing sidebar...');
    sidebar.init();
  }

  // Handle sidebar toggle
  function setupSidebarToggles() {
    console.log('Setting up sidebar toggles...');
    const sidebarToggles = document.querySelectorAll('.submenu-toggle');
    
    sidebarToggles.forEach(toggle => {
      // Remove any existing event listeners to prevent duplicates
      const newToggle = toggle.cloneNode(true);
      toggle.parentNode.replaceChild(newToggle, toggle);
      
      newToggle.addEventListener('click', function(e) {
        console.log('Submenu toggle clicked');
        e.preventDefault();
        e.stopPropagation();
        
        const parent = this.closest('.has-submenu');
        if (!parent) return;
        
        const submenu = this.nextElementSibling;
        const isOpen = parent.classList.contains('open');
        
        console.log('Toggling submenu. Currently open:', isOpen);
        
        // Close all other open submenus first
        if (!isOpen) {
          document.querySelectorAll('.has-submenu.open').forEach(openMenu => {
            if (openMenu !== parent) {
              openMenu.classList.remove('open');
              const openSubmenu = openMenu.querySelector('.submenu');
              if (openSubmenu) openSubmenu.style.display = 'none';
              const openIcon = openMenu.querySelector('.dropdown-icon');
              if (openIcon) {
                openIcon.classList.remove('fa-chevron-up');
                openIcon.classList.add('fa-chevron-down');
              }
            }
          });
        }
        
        // Toggle current submenu
        parent.classList.toggle('open');
        
        if (submenu && submenu.classList.contains('submenu')) {
          submenu.style.display = isOpen ? 'none' : 'block';
          console.log('Submenu display set to:', submenu.style.display);
        }
        
        const icon = this.querySelector('.dropdown-icon');
        if (icon) {
          icon.classList.toggle('fa-chevron-down');
          icon.classList.toggle('fa-chevron-up');
        }
      });
    });
  }
  
  // Initialize sidebar toggles
  setupSidebarToggles();

  // Handle page navigation
  const navLinks = document.querySelectorAll('a[data-page]');
  navLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      const page = this.getAttribute('data-page');
      loadPage(page);
      
      // Update active state
      navLinks.forEach(l => l.parentElement.classList.remove('active'));
      this.parentElement.classList.add('active');
    });
  });

  // Function to load page content
  function loadPage(page) {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    // Show loading state
    mainContent.innerHTML = '<div class="loading">Loading...</div>';

    // In a real app, you would fetch the content from the server
    // For now, we'll handle the company-setup page specifically
    if (page === 'company-setup') {
      window.location.href = 'company-setup.html';
    } else if (page === 'machine-setup') {
      // Handle machine setup page
      mainContent.innerHTML = `
        <header class="main-header">
          <div class="header-title">
            <h1>Machine Setup</h1>
          </div>
          <div class="header-user">
            <div class="user-avatar">AD</div>
          </div>
        </header>
        <div class="dashboard-content">
          <div class="page-header">
            <h2>Machine Setup</h2>
            <p>Machine management interface will be implemented here.</p>
          </div>
        </div>
      `;
    } else {
      // Default content for other pages
      mainContent.innerHTML = `
        <header class="main-header">
          <div class="header-title">
            <h1>${page.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}</h1>
          </div>
          <div class="header-user">
            <div class="user-avatar">AD</div>
          </div>
        </header>
        <div class="dashboard-content">
          <div class="page-header">
            <h2>${page.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}</h2>
            <p>This page is under construction.</p>
          </div>
        </div>
      `;
    }
  }

  // Initialize the current page based on URL
  function initPage() {
    console.log('Initializing page...');
    const path = window.location.pathname;
    
    // Handle company setup page
    if (path.includes('company-setup.html')) {
      console.log('On company setup page');
      const companyLink = document.querySelector('[data-page="company-setup"]');
      if (companyLink) {
        const listItem = companyLink.closest('li');
        const submenu = companyLink.closest('.submenu');
        const parentMenu = companyLink.closest('.has-submenu');
        
        if (listItem) listItem.classList.add('active');
        if (submenu) submenu.style.display = 'block';
        if (parentMenu) {
          parentMenu.classList.add('open');
          const icon = parentMenu.querySelector('.dropdown-icon');
          if (icon) {
            icon.classList.remove('fa-chevron-down');
            icon.classList.add('fa-chevron-up');
          }
        }
      }
    }
    
    // Re-initialize sidebar toggles after page load
    setTimeout(setupSidebarToggles, 100);
  }

  // Initialize the page
  initPage();
  
  // Re-initialize after a short delay to ensure all elements are loaded
  setTimeout(initPage, 300);
});

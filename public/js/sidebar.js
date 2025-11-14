// Initialize sidebar functionality when DOM is fully loaded
document.addEventListener('DOMContentLoaded', function() {
  console.log('Initializing sidebar...');
  
  // Initialize sidebar toggles
  function initSidebarToggles() {
    console.log('Initializing sidebar toggles...');
    
    // Handle click on submenu toggle
    document.addEventListener('click', function(e) {
      const toggle = e.target.closest('.submenu-toggle');
      if (!toggle) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      const parent = toggle.closest('.has-submenu');
      if (!parent) return;
      
      const submenu = parent.querySelector('.submenu');
      if (!submenu) return;
      
      // Check if we're opening or closing
      const isOpening = !parent.classList.contains('open');
      
      // Close all other open submenus if opening a new one
      if (isOpening) {
        document.querySelectorAll('.has-submenu.open').forEach(openMenu => {
          if (openMenu !== parent) {
            openMenu.classList.remove('open');
            const openSubmenu = openMenu.querySelector('.submenu');
            if (openSubmenu) {
              openSubmenu.style.maxHeight = '0';
              openSubmenu.style.opacity = '0';
              openSubmenu.style.visibility = 'hidden';
            }
          }
        });
      }
      
      // Toggle the current submenu
      parent.classList.toggle('open');
      
      // Animate the submenu
      if (parent.classList.contains('open')) {
        submenu.style.maxHeight = submenu.scrollHeight + 'px';
        submenu.style.opacity = '1';
        submenu.style.visibility = 'visible';
      } else {
        submenu.style.maxHeight = '0';
        submenu.style.opacity = '0';
        submenu.style.visibility = 'hidden';
      }
      
      // Toggle the dropdown icon
      const icon = toggle.querySelector('.dropdown-icon');
      if (icon) {
        icon.style.transform = parent.classList.contains('open') ? 'rotate(180deg)' : 'rotate(0deg)';
      }
    });
    
    // Close submenus when clicking outside
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.has-submenu')) {
        document.querySelectorAll('.has-submenu.open').forEach(menu => {
          menu.classList.remove('open');
          const submenu = menu.querySelector('.submenu');
          if (submenu) {
            submenu.style.maxHeight = '0';
            submenu.style.opacity = '0';
            submenu.style.visibility = 'hidden';
          }
          const icon = menu.querySelector('.dropdown-icon');
          if (icon) {
            icon.style.transform = 'rotate(0deg)';
          }
        });
      }
    });
  }
  
  // Set active state for current page
  function setActivePage() {
    console.log('Setting active page...');
    const path = window.location.pathname;
    
    // Reset all active states
    document.querySelectorAll('.sidebar-nav li').forEach(item => {
      item.classList.remove('active');
    });
    
    // Set active state based on current page
    if (path.includes('company-setup.html')) {
      const link = document.querySelector('[data-page="company-setup"]');
      if (link) {
        const listItem = link.closest('li');
        if (listItem) listItem.classList.add('active');
        
        const parentMenu = link.closest('.has-submenu');
        if (parentMenu) {
          parentMenu.classList.add('open');
          const submenu = parentMenu.querySelector('.submenu');
          if (submenu) {
            submenu.style.maxHeight = submenu.scrollHeight + 'px';
            submenu.style.opacity = '1';
            submenu.style.visibility = 'visible';
          }
          const icon = parentMenu.querySelector('.dropdown-icon');
          if (icon) icon.style.transform = 'rotate(180deg)';
        }
      }
    }
  }
  
  // Initialize everything
  function init() {
    initSidebarToggles();
    setActivePage();
    
    // Re-initialize after a short delay to ensure all elements are loaded
    setTimeout(() => {
      initSidebarToggles();
      setActivePage();
    }, 300);
  }
  
  // Start initialization
  init();
  
  // Re-initialize when navigating back/forward
  window.addEventListener('popstate', init);
});

// Make functions available globally
window.sidebar = {
  init: function() {
    const event = new Event('DOMContentLoaded');
    document.dispatchEvent(event);
  }
};

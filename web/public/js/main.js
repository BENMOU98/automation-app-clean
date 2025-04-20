/**
 * WordPress Automation Platform - Client-side JavaScript
 * Handles UI interactions, form submissions, and progress updates
 */

document.addEventListener('DOMContentLoaded', function() {
    // Initialize UI elements based on the current page
    const currentPath = window.location.pathname;
    
    // Common elements
    const logContainer = document.getElementById('log-container');
    
    // Handle the dashboard page
    if (currentPath === '/' || currentPath === '/index') {
        initializeDashboard();
    }
    
    // Handle the keywords page
    if (currentPath === '/keywords') {
        initializeKeywordsPage();
    }
    
    // Handle the history page
    if (currentPath === '/history') {
        // Currently no special handling needed for history page
    }
    
    /**
     * Initialize the dashboard page functionality
     */
    function initializeDashboard() {
        const startJobBtn = document.getElementById('start-job-btn');
        const processSingleKeywordBtn = document.getElementById('process-single-keyword-btn');
        const singleKeywordSelect = document.getElementById('single-keyword-select');
        
        // If a job is already running, start the status polling
        if (typeof isJobRunning !== 'undefined' && isJobRunning) {
            pollJobStatus();
        }
        
        // Start job button click handler
        if (startJobBtn) {
            startJobBtn.addEventListener('click', function() {
                if (confirm('Are you sure you want to start the automation process for all keywords?')) {
                    startJob();
                }
            });
        }
        
        // Process single keyword button click handler
if (processSingleKeywordBtn) {
    processSingleKeywordBtn.addEventListener('click', function() {
        const keyword = document.getElementById('single-keyword-select').value;
        
        if (keyword) {
            if (confirm(`Are you sure you want to process the keyword "${keyword}"?`)) {
                // Redirect directly to the generate-preview page
                window.location.href = `/generate-preview/${encodeURIComponent(keyword)}`;
            }
        } else {
            showAlert('Please select a keyword to process', 'warning');
        }
    });
}
        
        // Single keyword select change handler
        if (singleKeywordSelect) {
            singleKeywordSelect.addEventListener('change', function() {
                if (processSingleKeywordBtn) {
                    processSingleKeywordBtn.disabled = !this.value;
                }
            });
            
            // Load pending keywords
            loadPendingKeywords();
        }
    }
    
    /**
     * Initialize the keywords page functionality
     */
    function initializeKeywordsPage() {
        const addKeywordForm = document.getElementById('add-keyword-form');
        const uploadExcelForm = document.getElementById('upload-excel-form');
        const deleteButtons = document.querySelectorAll('.delete-keyword-btn');
        const confirmDeleteBtn = document.getElementById('confirmDeleteKeyword');
        const deleteModal = new bootstrap.Modal(document.getElementById('deleteKeywordModal'));
        let keywordToDelete = '';
        
        // Add keyword form submission
        if (addKeywordForm) {
            addKeywordForm.addEventListener('submit', function(e) {
                e.preventDefault();
                const keywordInput = document.getElementById('keyword');
                const keyword = keywordInput.value.trim();
                
                if (!keyword) {
                    showAlert('Please enter a keyword', 'danger');
                    return;
                }
                
                addKeyword(keyword);
            });
        }
        
        // Upload Excel form submission
        if (uploadExcelForm) {
            uploadExcelForm.addEventListener('submit', function(e) {
                e.preventDefault();
                const fileInput = document.getElementById('excelFile');
                
                if (!fileInput.files || fileInput.files.length === 0) {
                    showAlert('Please select an Excel file', 'danger');
                    return;
                }
                
                uploadExcelFile(fileInput.files[0]);
            });
        }
        
        // Delete keyword buttons
        deleteButtons.forEach(button => {
            button.addEventListener('click', function() {
                keywordToDelete = this.getAttribute('data-keyword');
                document.getElementById('keywordToDelete').textContent = keywordToDelete;
                deleteModal.show();
            });
        });
        
        // Confirm delete keyword
        if (confirmDeleteBtn) {
            confirmDeleteBtn.addEventListener('click', function() {
                if (keywordToDelete) {
                    deleteKeyword(keywordToDelete);
                    deleteModal.hide();
                }
            });
        }
    }
    
    /**
     * Load pending keywords from the server
     */
    function loadPendingKeywords() {
        const singleKeywordSelect = document.getElementById('single-keyword-select');
        if (!singleKeywordSelect) return;
        
        // Show loading state
        singleKeywordSelect.innerHTML = '<option value="">Loading keywords...</option>';
        singleKeywordSelect.disabled = true;
        
        // Create a new XMLHttpRequest object to get the keywords page
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '/keywords', true);
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4 && xhr.status === 200) {
                try {
                    // Parse the HTML response
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(xhr.responseText, 'text/html');
                    
                    // Find all keyword cells and status cells
                    const keywordCells = doc.querySelectorAll('td[data-keyword]');
                    const statusCells = doc.querySelectorAll('td[data-status]');
                    
                    // Clear and repopulate the dropdown
                    singleKeywordSelect.innerHTML = '<option value="">-- Select a keyword --</option>';
                    
                    // Track if we found any pending keywords
                    let pendingCount = 0;
                    
                    // Add each pending keyword as an option
                    for (let i = 0; i < keywordCells.length; i++) {
                        const keyword = keywordCells[i].getAttribute('data-keyword');
                        const status = statusCells[i].getAttribute('data-status');
                        
                        // Status might be in the cell text instead of the attribute
                        const statusText = statusCells[i].textContent.trim();
                        const isPending = status === 'Pending' || statusText.includes('Pending');
                        
                        if (isPending) {
                            const option = document.createElement('option');
                            option.value = keyword;
                            option.textContent = keyword;
                            singleKeywordSelect.appendChild(option);
                            pendingCount++;
                        }
                    }
                    
                    // Enable the select now that we've populated it
                    singleKeywordSelect.disabled = false;
                    
                    // Update the process button state
                    const processSingleKeywordBtn = document.getElementById('process-single-keyword-btn');
                    if (processSingleKeywordBtn) {
                        processSingleKeywordBtn.disabled = pendingCount === 0;
                    }
                    
                    // Show message if no pending keywords
                    if (pendingCount === 0) {
                        singleKeywordSelect.innerHTML = '<option value="">No pending keywords available</option>';
                        // Show a notification
                        showAlert('No pending keywords found. Add keywords with "Pending" status first.', 'info');
                    }
                } catch (e) {
                    console.error('Error parsing keywords page:', e);
                    singleKeywordSelect.innerHTML = '<option value="">Error loading keywords</option>';
                    singleKeywordSelect.disabled = false;
                    showAlert('Failed to load keywords. Please refresh the page.', 'danger');
                }
            } else if (xhr.readyState === 4) {
                // Handle error
                singleKeywordSelect.innerHTML = '<option value="">Error loading keywords</option>';
                singleKeywordSelect.disabled = false;
                showAlert('Failed to load keywords. Please refresh the page.', 'danger');
            }
        };
        xhr.send();
    }
    
    /**
     * Process a single keyword
     */
    function processSingleKeyword(keyword) {
        fetch('/api/process-single-keyword', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ keyword })
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(data => {
                    throw new Error(data.error || 'An error occurred');
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                showAlert(`Started processing keyword: ${keyword}`, 'success');
                pollJobStatus();
                
                // Disable the buttons
                const startJobBtn = document.getElementById('start-job-btn');
                const processSingleKeywordBtn = document.getElementById('process-single-keyword-btn');
                const singleKeywordSelect = document.getElementById('single-keyword-select');
                
                if (startJobBtn) startJobBtn.disabled = true;
                if (processSingleKeywordBtn) processSingleKeywordBtn.disabled = true;
                if (singleKeywordSelect) singleKeywordSelect.disabled = true;
            } else {
                showAlert(`Failed to process keyword: ${data.error || 'Unknown error'}`, 'danger');
            }
        })
        .catch(error => {
            showAlert(`Error: ${error.message}`, 'danger');
        });
    }
    
    /**
     * Start the automation job
     */
    function startJob() {
        fetch('/api/start-job', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showAlert('Job started successfully', 'success');
                pollJobStatus();
                
                // Disable the start button
                const startJobBtn = document.getElementById('start-job-btn');
                if (startJobBtn) {
                    startJobBtn.disabled = true;
                    startJobBtn.innerHTML = '<i class="bi bi-hourglass"></i> Running...';
                }
            } else {
                showAlert(`Failed to start job: ${data.error}`, 'danger');
            }
        })
        .catch(error => {
            showAlert(`Error: ${error.message}`, 'danger');
        });
    }
    
    /**
     * Poll for job status updates
     */
    function pollJobStatus() {
        const statusInterval = setInterval(function() {
            fetch('/api/job-status')
                .then(response => response.json())
                .then(data => {
                    updateJobStatus(data);
                    
                    // Stop polling if the job is no longer running
                    if (!data.isRunning) {
                        clearInterval(statusInterval);
                        setTimeout(() => {
                            window.location.reload();
                        }, 3000);
                    }
                })
                .catch(error => {
                    console.error('Error fetching job status:', error);
                });
        }, 2000);
    }
    
    /**
     * Update the job status display
     */
    function updateJobStatus(data) {
        const progress = data.progress;
        
        // Update progress bar if it exists
        const progressBar = document.querySelector('.progress-bar');
        if (progressBar) {
            const percentage = Math.round((progress.current / progress.total) * 100) || 0;
            progressBar.style.width = `${percentage}%`;
            progressBar.textContent = `${percentage}%`;
            progressBar.setAttribute('aria-valuenow', percentage);
        }
        
        // Update status text
        const statusElements = document.querySelectorAll('strong');
        statusElements.forEach(element => {
            if (element.textContent.includes('Current Keyword:')) {
                element.nextSibling.textContent = ` ${progress.currentKeyword}`;
            } else if (element.textContent.includes('Progress:')) {
                element.nextSibling.textContent = ` ${progress.current} of ${progress.total}`;
            } else if (element.textContent.includes('Status:')) {
                element.nextSibling.textContent = ` ${progress.status}`;
            }
        });
        
        // Update log
        if (logContainer && progress.log) {
            logContainer.innerHTML = '';
            progress.log.forEach(logItem => {
                const logLine = document.createElement('div');
                logLine.className = 'log-line';
                logLine.textContent = logItem;
                logContainer.appendChild(logLine);
            });
            
            // Scroll to bottom
            logContainer.scrollTop = logContainer.scrollHeight;
        }
    }
    
    /**
     * Add a new keyword
     */
    function addKeyword(keyword) {
        fetch('/api/add-keyword', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ keyword })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showAlert('Keyword added successfully', 'success');
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } else {
                showAlert(`Failed to add keyword: ${data.error}`, 'danger');
            }
        })
        .catch(error => {
            showAlert(`Error: ${error.message}`, 'danger');
        });
    }
    
    /**
     * Delete a keyword
     */
    function deleteKeyword(keyword) {
        fetch('/api/delete-keyword', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ keyword })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showAlert('Keyword deleted successfully', 'success');
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } else {
                showAlert(`Failed to delete keyword: ${data.error}`, 'danger');
            }
        })
        .catch(error => {
            showAlert(`Error: ${error.message}`, 'danger');
        });
    }
    
    /**
     * Upload Excel file
     */
    function uploadExcelFile(file) {
        const formData = new FormData();
        formData.append('excelFile', file);
        
        fetch('/api/upload-excel', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showAlert('Excel file uploaded successfully', 'success');
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } else {
                showAlert(`Failed to upload file: ${data.error}`, 'danger');
            }
        })
        .catch(error => {
            showAlert(`Error: ${error.message}`, 'danger');
        });
    }
    
    /**
     * Show an alert message
     */
    function showAlert(message, type = 'info') {
        // Create alert container if it doesn't exist
        let alertContainer = document.querySelector('.alert-container');
        if (!alertContainer) {
            alertContainer = document.createElement('div');
            alertContainer.className = 'alert-container position-fixed top-0 end-0 p-3';
            document.body.appendChild(alertContainer);
        }
        
        // Create alert element
        const alertEl = document.createElement('div');
        alertEl.className = `alert alert-${type} alert-dismissible fade show`;
        alertEl.role = 'alert';
        alertEl.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        
        // Add to container
        alertContainer.appendChild(alertEl);
        
        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            alertEl.classList.remove('show');
            setTimeout(() => {
                alertEl.remove();
            }, 300);
        }, 5000);
    }
});
// Add this to your existing main.js file

// Update the single keyword processing to use preview mode
function updateProcessSingleKeyword() {
    const processSingleKeywordBtn = document.getElementById('process-single-keyword-btn');
    
    if (processSingleKeywordBtn) {
      // Replace the existing event listener (you'll need to remove the old one first)
      processSingleKeywordBtn.removeEventListener('click', processSingleKeywordClickHandler);
      
      // Add new event listener
      processSingleKeywordBtn.addEventListener('click', function() {
        const keyword = document.getElementById('single-keyword-select').value;
        
        if (keyword) {
          if (confirm(`Are you sure you want to process the keyword "${keyword}"?`)) {
            // Redirect to generate page instead of processing directly
            window.location.href = `/generate-preview/${encodeURIComponent(keyword)}`;
          }
        } else {
          showAlert('Please select a keyword to process', 'warning');
        }
      });
    }
  }
  
  // Update the automation options section
  function updateAutomationOptions() {
    const startJobBtn = document.getElementById('start-job-btn');
    
    if (startJobBtn) {
      // Add preview mode toggle
      const automationOptions = document.querySelector('.automation-options');
      
      if (automationOptions) {
        // Check if preview toggle already exists
        if (!document.getElementById('preview-mode-toggle')) {
          const previewToggleHtml = `
          <div class="preview-toggle mt-3 pt-3 border-top">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="preview-mode-toggle" checked>
              <label class="form-check-label" for="preview-mode-toggle">
                <strong>Preview Mode</strong> - Review articles before publishing
              </label>
            </div>
          </div>
          `;
          
          automationOptions.insertAdjacentHTML('beforeend', previewToggleHtml);
          
          // Add event listener for the toggle
          const previewModeToggle = document.getElementById('preview-mode-toggle');
          previewModeToggle.addEventListener('change', function() {
            localStorage.setItem('previewMode', this.checked);
            updateButtonLabels(this.checked);
          });
          
          // Initialize from localStorage
          const savedPreviewMode = localStorage.getItem('previewMode');
          if (savedPreviewMode !== null) {
            previewModeToggle.checked = savedPreviewMode === 'true';
          }
          
          // Initial update of button labels
          updateButtonLabels(previewModeToggle.checked);
        }
      }
      
      // Update the start job button functionality
      startJobBtn.removeEventListener('click', startJobClickHandler);
      startJobBtn.addEventListener('click', function() {
        const previewMode = document.getElementById('preview-mode-toggle').checked;
        
        if (previewMode) {
          // In preview mode, we need to select a keyword first
          showAlert('Please select a specific keyword to process in preview mode', 'info');
        } else {
          // Original functionality
          if (confirm('Are you sure you want to start the automation process for all keywords?')) {
            startJob();
          }
        }
      });
    }
  }
  
  // Update button labels based on preview mode
  function updateButtonLabels(previewMode) {
    const startJobBtn = document.getElementById('start-job-btn');
    const processSingleKeywordBtn = document.getElementById('process-single-keyword-btn');
    
    if (startJobBtn) {
      if (previewMode) {
        startJobBtn.innerHTML = '<i class="bi bi-play-fill"></i> Start Full Automation (disabled in preview mode)';
        startJobBtn.disabled = true;
      } else {
        startJobBtn.innerHTML = '<i class="bi bi-play-fill"></i> Start Full Automation';
        startJobBtn.disabled = (!configValid || !wpConnectionStatus || !excelFileExists);
      }
    }
    
    if (processSingleKeywordBtn) {
      if (previewMode) {
        processSingleKeywordBtn.innerHTML = '<i class="bi bi-eye"></i> Preview & Edit';
      } else {
        processSingleKeywordBtn.innerHTML = '<i class="bi bi-play-fill"></i> Process';
      }
    }
  }
  
  // Run when page is loaded
  document.addEventListener('DOMContentLoaded', function() {
    // Only run this code on the dashboard page
    if (window.location.pathname === '/' || window.location.pathname === '/index') {
      updateProcessSingleKeyword();
      updateAutomationOptions();
    }
  });
  // Add this function to your existing main.js file

/**
 * Fetch and update keyword statistics on the dashboard
 */
function fetchKeywordStats() {
    // Only run this on the dashboard page
    if (window.location.pathname !== '/' && window.location.pathname !== '/index') {
      return;
    }
    
    // Check if the stats elements exist
    const totalElement = document.getElementById('total-keywords');
    const publishedElement = document.getElementById('published-keywords');
    const pendingElement = document.getElementById('pending-keywords');
    const successRateElement = document.getElementById('success-rate');
    
    if (!totalElement || !publishedElement || !pendingElement || !successRateElement) {
      return;
    }
    
    // Fetch the latest stats from the server
    fetch('/api/keyword-stats')
      .then(response => response.json())
      .then(data => {
        // Update the dashboard with real counts
        totalElement.textContent = data.total;
        publishedElement.textContent = data.published;
        pendingElement.textContent = data.pending;
        
        // Calculate and update success rate if there are published keywords
        if (data.total > 0) {
          const successRate = Math.round((data.published / data.total) * 100);
          successRateElement.textContent = `${successRate}%`;
        } else {
          successRateElement.textContent = '0%';
        }
      })
      .catch(error => {
        console.error('Error fetching keyword stats:', error);
      });
  }
  
  // Modify the initializeDashboard function to include stats fetching
  function initializeDashboard() {
    const startJobBtn = document.getElementById('start-job-btn');
    const processSingleKeywordBtn = document.getElementById('process-single-keyword-btn');
    const singleKeywordSelect = document.getElementById('single-keyword-select');
    
    // Fetch keyword stats immediately
    fetchKeywordStats();
    
    // Set up periodic refresh of keyword stats (every 30 seconds)
    const statsInterval = setInterval(fetchKeywordStats, 30000);
    
    // If a job is already running, start the status polling
    if (typeof isJobRunning !== 'undefined' && isJobRunning) {
      pollJobStatus();
    }
    
    // Start job button click handler
    if (startJobBtn) {
      startJobBtn.addEventListener('click', function() {
        if (confirm('Are you sure you want to start the automation process for all keywords?')) {
          startJob();
        }
      });
    }
    
    // Process single keyword button click handler
    if (processSingleKeywordBtn) {
      processSingleKeywordBtn.addEventListener('click', function() {
        const keyword = document.getElementById('single-keyword-select').value;
        
        if (keyword) {
          if (confirm(`Are you sure you want to process the keyword "${keyword}"?`)) {
            // Redirect directly to the generate-preview page
            window.location.href = `/generate-preview/${encodeURIComponent(keyword)}`;
          }
        } else {
          showAlert('Please select a keyword to process', 'warning');
        }
      });
    }
    
    // Single keyword select change handler
    if (singleKeywordSelect) {
      singleKeywordSelect.addEventListener('change', function() {
        if (processSingleKeywordBtn) {
          processSingleKeywordBtn.disabled = !this.value;
        }
      });
      
      // Load pending keywords
      loadPendingKeywords();
    }
  }
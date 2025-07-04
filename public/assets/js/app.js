// ===== MAIN APPLICATION =====

class ClaudeCodeWebManager extends EventEmitter {
    constructor() {
        super();
        this.isInitialized = false;
        this.systemStats = {};
        
        this.init();
    }
    
    async init() {
        try {
            // Show loading screen
            this.showLoadingScreen();
            
            // Initialize components
            await this.initializeComponents();
            
            // Setup global event handlers
            this.setupGlobalEventHandlers();
            
            // Setup keyboard shortcuts
            this.setupKeyboardShortcuts();
            
            // Check authentication
            await this.checkAuthentication();
            
            // Hide loading screen and show app
            this.hideLoadingScreen();
            
            // Initialize system monitoring
            this.initializeSystemMonitoring();
            
            this.isInitialized = true;
            this.emit('app_initialized');
            
            console.log('🚀 Claude Code Web Manager initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize application:', error);
            this.showErrorScreen(error);
        }
    }
    
    showLoadingScreen() {
        const loadingScreen = DOM.get('loading-screen');
        const app = DOM.get('app');
        
        if (loadingScreen) DOM.show(loadingScreen);
        if (app) DOM.hide(app);
    }
    
    hideLoadingScreen() {
        const loadingScreen = DOM.get('loading-screen');
        const app = DOM.get('app');
        
        if (loadingScreen) {
            setTimeout(() => {
                DOM.hide(loadingScreen);
                if (app) DOM.show(app);
            }, 500);
        }
    }
    
    showErrorScreen(error) {
        const loadingScreen = DOM.get('loading-screen');
        if (loadingScreen) {
            loadingScreen.innerHTML = `
                <div class="loading-content">
                    <div class="error-icon">❌</div>
                    <h2>Failed to Initialize</h2>
                    <p>Claude Code Web Manager failed to start:</p>
                    <p class="error-message">${error.message}</p>
                    <button class="btn btn-primary" onclick="location.reload()">Retry</button>
                </div>
            `;
        }
    }
    
    async initializeComponents() {
        // Ensure socket is available
        if (typeof socket === 'undefined') {
            throw new Error('Socket client not available');
        }
        
        // Wait for socket connection
        if (!socket.isConnected()) {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Socket connection timeout'));
                }, 10000);
                
                socket.onConnected(() => {
                    clearTimeout(timeout);
                    resolve();
                });
                
                socket.onConnectionError((error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });
        }
    }
    
    setupGlobalEventHandlers() {
        // Theme toggle
        DOM.on('theme-toggle', 'click', () => {
            theme.toggle();
        });
        
        // Settings button
        DOM.on('settings-btn', 'click', () => {
            this.showSettings();
        });
        
        
        
        
        
        // Modal close handlers
        DOM.queryAll('.modal-close').forEach(btn => {
            DOM.on(btn, 'click', () => {
                modals.close();
            });
        });
        
        // Settings tabs
        DOM.on(document, 'click', (e) => {
            if (e.target.classList.contains('settings-tab')) {
                this.switchSettingsTab(e.target.dataset.tab);
            }
        });
        
        // Window events
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
        
        window.addEventListener('resize', Utils.throttle(() => {
            this.handleWindowResize();
        }, 250));
        
        // System monitoring
        socket.onSystemStatus((data) => {
            this.updateSystemStatus(data);
        });
    }
    
    setupKeyboardShortcuts() {
        // Global shortcuts
        keyboard.register('ctrl+n', () => {
            projectManager.showCreateProjectModal();
        });
        
        
        keyboard.register('ctrl+,', () => {
            this.showSettings();
        });
        
        
        keyboard.register('escape', () => {
            this.handleEscapeKey();
        });
        
        // Terminal shortcuts are handled by TerminalManager
        // Project shortcuts are handled by ProjectManager
    }
    
    async checkAuthentication() {
        try {
            // Check if authentication is enabled
            const response = await HTTP.get('/api/auth/user');
            
            if (!response.success && response.error === 'Not authenticated') {
                this.showAuthModal();
                return;
            }
            
            // Authentication successful or not required
            console.log('✅ Authentication check passed');
            
        } catch (error) {
            if (error.message.includes('401')) {
                this.showAuthModal();
            } else {
                console.warn('Authentication check failed:', error);
                // Continue anyway for development
            }
        }
    }
    
    showAuthModal() {
        const authModal = DOM.get('auth-modal');
        const loginForm = DOM.get('login-form');
        
        if (authModal && loginForm) {
            DOM.show(authModal);
            
            // Setup login form handler
            DOM.on(loginForm, 'submit', async (e) => {
                e.preventDefault();
                await this.handleLogin(e.target);
            });
        }
    }
    
    async handleLogin(form) {
        try {
            const formData = new FormData(form);
            const credentials = {
                username: formData.get('username'),
                password: formData.get('password')
            };
            
            const response = await HTTP.post('/api/auth/login', credentials);
            
            if (response.success) {
                DOM.hide('auth-modal');
                notifications.success('Login successful');
                
                // Re-initialize socket with auth
                socket.authenticate(response.token);
                
            } else {
                this.showAuthError(response.error || 'Login failed');
            }
            
        } catch (error) {
            console.error('Login failed:', error);
            this.showAuthError(error.message);
        }
    }
    
    showAuthError(message) {
        const errorElement = DOM.get('auth-error');
        if (errorElement) {
            errorElement.textContent = message;
            DOM.show(errorElement);
            
            setTimeout(() => {
                DOM.hide(errorElement);
            }, 5000);
        }
    }
    
    initializeSystemMonitoring() {
        // Update system metrics periodically
        setInterval(() => {
            this.updateSystemMetrics();
        }, 5000);
        
        // Initial update
        this.updateSystemMetrics();
    }
    
    async updateSystemMetrics() {
        try {
            const response = await HTTP.get('/api/system/status');
            
            if (response.success) {
                this.systemStats = response.system;
                this.updateSystemUI();
            }
        } catch (error) {
            console.warn('Failed to get system status:', error);
        }
    }
    
    updateSystemUI() {
        // Update header system load
        const systemLoad = DOM.get('system-load');
        if (systemLoad && this.systemStats.cpu) {
            systemLoad.querySelector('.text').textContent = `CPU: ${this.systemStats.cpu.usage}%`;
        }
        
        // Update temperature display
        const systemTemp = DOM.get('system-temp');
        if (systemTemp && this.systemStats.temperature) {
            const temp = this.systemStats.temperature.cpu;
            systemTemp.querySelector('.text').textContent = `Temp: ${temp}°C`;
        }
        
        // Update memory display
        const systemMemory = DOM.get('system-memory');
        if (systemMemory && this.systemStats.memory) {
            const memUsage = this.systemStats.memory.usage;
            systemMemory.querySelector('.text').textContent = `RAM: ${memUsage}%`;
        }
    }
    
    updateSystemStatus(data) {
        // Update connection count and other real-time stats
        console.log('📊 System status update:', data);
    }
    
    showSettings(defaultTab = 'general') {
        const settingsModal = DOM.get('settings-modal');
        const settingsContent = settingsModal?.querySelector('.settings-content');
        
        if (settingsContent) {
            this.renderSettingsContent(settingsContent);
            this.loadSettingsValues();
            this.switchSettingsTab(defaultTab);
        }
        
        modals.open('settings-modal');
    }
    
    renderSettingsContent(container) {
        container.innerHTML = `
            <div class="settings-panel active" data-panel="general">
                <div class="settings-group">
                    <h4>Appearance</h4>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <div class="settings-item-title">Theme</div>
                            <div class="settings-item-description">Choose between light and dark themes</div>
                        </div>
                        <div class="settings-item-control">
                            <select id="theme-select">
                                <option value="dark" ${theme.getTheme() === 'dark' ? 'selected' : ''}>Dark</option>
                                <option value="light" ${theme.getTheme() === 'light' ? 'selected' : ''}>Light</option>
                            </select>
                        </div>
                    </div>
                </div>
                
                <div class="settings-group">
                    <h4>Notifications</h4>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <div class="settings-item-title">Enable Notifications</div>
                            <div class="settings-item-description">Show system and project notifications</div>
                        </div>
                        <div class="settings-item-control">
                            <input type="checkbox" id="notifications-enabled" checked>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="settings-panel" data-panel="terminal">
                <div class="settings-group">
                    <h4>Terminal Appearance</h4>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <div class="settings-item-title">Font Size</div>
                            <div class="settings-item-description">Terminal font size in pixels</div>
                        </div>
                        <div class="settings-item-control">
                            <input type="range" id="terminal-font-size" min="10" max="24" value="14">
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="settings-panel" data-panel="claude">
                <div class="settings-group">
                    <h4>Claude Code Integration</h4>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <div class="settings-item-title">Auto-start Claude</div>
                            <div class="settings-item-description">Automatically start Claude when opening projects</div>
                        </div>
                        <div class="settings-item-control">
                            <input type="checkbox" id="auto-start-claude">
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="settings-panel" data-panel="system">
                <div class="settings-group">
                    <h4>System Information</h4>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <div class="settings-item-title">Memory Usage</div>
                            <div class="settings-item-description">${this.systemStats.memory?.used || 0} MB used</div>
                        </div>
                    </div>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <div class="settings-item-title">CPU Usage</div>
                            <div class="settings-item-description">${this.systemStats.cpu?.usage || 0}% average</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Setup settings event handlers
        DOM.on('theme-select', 'change', (e) => {
            theme.applyTheme(e.target.value);
        });
        
        // Terminal settings event handlers
        DOM.on('terminal-font-size', 'input', (e) => {
            const fontSize = parseInt(e.target.value);
            if (window.terminalManager && window.terminalManager.activeTerminal) {
                const terminal = window.terminalManager.terminals.get(window.terminalManager.activeTerminal).terminal;
                window.terminalManager.setTerminalFont(terminal, fontSize);
            }
        });
        
    }
    
    loadSettingsValues() {
        // Load terminal settings
        const savedFontSize = Storage.get('terminal-font-size') || 14;
        
        // Set font size slider value
        const fontSizeSlider = DOM.get('terminal-font-size');
        if (fontSizeSlider) {
            fontSizeSlider.value = savedFontSize;
        }
    }
    
    switchSettingsTab(tabName) {
        // Update tab buttons
        DOM.queryAll('.settings-tab').forEach(tab => {
            DOM.removeClass(tab, 'active');
        });
        DOM.addClass(DOM.query(`[data-tab="${tabName}"]`), 'active');
        
        // Update panels
        DOM.queryAll('.settings-panel').forEach(panel => {
            DOM.removeClass(panel, 'active');
        });
        DOM.addClass(DOM.query(`[data-panel="${tabName}"]`), 'active');
    }
    
    
    
    
    showDebugInfo() {
        const debugInfo = {
            socket: socket.getDebugInfo(),
            projects: projectManager.getAllProjects().length,
            terminals: terminalManager.getAllTerminals().length,
            currentProject: projectManager.getCurrentProject()?.id,
            systemStats: this.systemStats
        };
        
        console.log('🔧 Debug Info:', debugInfo);
        notifications.info('Debug information logged to console');
    }
    
    
    handleEscapeKey() {
        // Close modals
        if (modals.isOpen()) {
            modals.close();
            return;
        }
        
        // Close context menus
        const contextMenu = DOM.get('context-menu');
        if (contextMenu && DOM.hasClass(contextMenu, 'active')) {
            DOM.removeClass(contextMenu, 'active');
            return;
        }
        
    }
    
    handleWindowResize() {
        // Fit active terminal
        const activeTerminal = terminalManager.getActiveTerminal();
        if (activeTerminal && activeTerminal.fitAddon) {
            activeTerminal.fitAddon.fit();
        }
    }
    
    cleanup() {
        console.log('🧹 Cleaning up application...');
        
        // Leave current project
        if (projectManager.getCurrentProject()) {
            socket.leaveProject();
        }
        
        // Disconnect socket
        socket.disconnect();
    }
    
    // Public API methods
    getSystemStats() {
        return this.systemStats;
    }
    
    isReady() {
        return this.isInitialized;
    }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Wait a bit for all scripts to load
    setTimeout(() => {
        try {
            // Check if required globals are available
            if (typeof socket === 'undefined') {
                throw new Error('Socket client not initialized');
            }
            if (typeof terminalManager === 'undefined') {
                throw new Error('Terminal manager not initialized');
            }
            if (typeof projectManager === 'undefined') {
                throw new Error('Project manager not initialized');
            }
            
            window.app = new ClaudeCodeWebManager();
            
            // Initialize image manager socket connection
            if (window.ImageManager && window.socket) {
                window.ImageManager.setSocket(window.socket);
            }
        } catch (error) {
            console.error('❌ Failed to initialize app:', error);
            
            // Show error in loading screen
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) {
                loadingScreen.innerHTML = `
                    <div class="loading-content">
                        <div class="error-icon">❌</div>
                        <h2>Failed to Initialize</h2>
                        <p>Claude Code Web Manager failed to start:</p>
                        <p class="error-message">${error.message}</p>
                        <button class="btn btn-primary" onclick="location.reload()">Retry</button>
                    </div>
                `;
            }
        }
    }, 100);
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log('📱 Page hidden');
    } else {
        console.log('📱 Page visible');
        // Refresh when page becomes visible again
        if (window.app && window.app.isReady()) {
            projectManager.refreshProjects();
        }
    }
});

// Global error handling
window.addEventListener('error', (event) => {
    console.error('❌ Global error:', event.error);
    notifications.error('An unexpected error occurred');
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('❌ Unhandled promise rejection:', event.reason);
    notifications.error('An unexpected error occurred');
});

console.log('🚀 Claude Code Web Manager loading...');
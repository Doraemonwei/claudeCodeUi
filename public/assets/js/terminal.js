// ===== TERMINAL INTEGRATION WITH XTERM.JS =====

class TerminalManager extends EventEmitter {
    constructor() {
        super();
        this.terminals = new Map();
        this.activeTerminal = null;
        this.terminalCounter = 0;
        this.container = DOM.get('terminal-content');
        this.tabsContainer = DOM.get('terminal-tabs');
        this.welcomeScreen = DOM.get('welcome-screen');
        
        this.setupTerminalControls();
        this.setupKeyboardShortcuts();
        
        // Listen for socket events
        socket.onTerminalOutput(this.handleTerminalOutput.bind(this));
        socket.onClaudeResponse(this.handleClaudeResponse.bind(this));
        socket.onProjectStatus(this.handleProjectStatus.bind(this));
    }
    
    setupTerminalControls() {
        // Terminal control buttons have been removed as per UI simplification
        // Functionality is still available via keyboard shortcuts
    }
    
    setupKeyboardShortcuts() {
        keyboard.register('ctrl+`', () => {
            this.toggleTerminal();
        });
        
        keyboard.register('ctrl+shift+c', () => {
            this.clearActiveTerminal();
        });
        
        keyboard.register('ctrl+shift+t', () => {
            this.createTerminal();
        });
        
        keyboard.register('ctrl+shift+w', () => {
            this.closeActiveTerminal();
        });
        
        // Tab navigation
        keyboard.register('ctrl+tab', () => {
            this.switchToNextTerminal();
        });
        
        keyboard.register('ctrl+shift+tab', () => {
            this.switchToPreviousTerminal();
        });
        
        // Terminal switching by number
        for (let i = 1; i <= 9; i++) {
            keyboard.register(`ctrl+${i}`, () => {
                this.switchToTerminal(i - 1);
            });
        }
    }
    
    createTerminal(projectId = null, options = {}) {
        const terminalId = `terminal-${++this.terminalCounter}`;
        const isClaudeTerminal = Boolean(projectId);
        
        // Load saved settings
        const savedFontSize = Storage.get('terminal-font-size') || 14;
        
        // Create terminal instance with fixed high-contrast theme
        const terminal = new Terminal({
            fontFamily: 'Fira Code, Monaco, Menlo, Ubuntu Mono, monospace',
            fontSize: parseInt(savedFontSize),
            fontWeight: 'normal',
            fontWeightBold: 'bold',
            lineHeight: 1.2,
            letterSpacing: 0,
            cursor: 'block',
            cursorBlink: true,
            cursorStyle: 'block',
            scrollback: 1000,
            tabStopWidth: 4,
            theme: this.getThemeConfig(this.getCurrentTheme()),
            allowTransparency: false,
            bellSound: null,
            bellStyle: 'none',
            convertEol: true,
            disableStdin: false,
            macOptionIsMeta: true,
            macOptionClickForcesSelection: false,
            rightClickSelectsWord: true,
            ...options
        });
        
        // Create addons
        const fitAddon = new FitAddon.FitAddon();
        const webLinksAddon = new WebLinksAddon.WebLinksAddon();
        
        // Load addons
        terminal.loadAddon(fitAddon);
        terminal.loadAddon(webLinksAddon);
        
        // Create terminal wrapper element
        const terminalElement = DOM.create('div', {
            className: 'terminal-instance',
            id: terminalId
        });
        
        const terminalWrapper = DOM.create('div', {
            className: 'terminal-wrapper'
        });
        
        const statusBar = this.createStatusBar(terminalId, projectId);
        
        terminalElement.appendChild(terminalWrapper);
        terminalElement.appendChild(statusBar);
        this.container.appendChild(terminalElement);
        
        // Open terminal in wrapper
        terminal.open(terminalWrapper);
        
        // Fit terminal to container
        fitAddon.fit();
        
        // Setup terminal event handlers
        this.setupTerminalEvents(terminal, terminalId, projectId);
        
        // Create tab
        const tab = this.createTerminalTab(terminalId, projectId, isClaudeTerminal);
        
        // Store terminal data
        const terminalData = {
            id: terminalId,
            terminal,
            element: terminalElement,
            tab,
            fitAddon,
            webLinksAddon,
            projectId,
            isClaudeTerminal,
            statusBar,
            history: [],
            historyIndex: -1,
            currentInput: '',
            isActive: false
        };
        
        this.terminals.set(terminalId, terminalData);
        
        // Make this terminal active
        this.setActiveTerminal(terminalId);
        
        // Hide welcome screen
        if (this.welcomeScreen) {
            DOM.hide(this.welcomeScreen);
        }
        
        // Focus terminal
        terminal.focus();
        
        // Don't show initial messages - let the shell show its natural prompt
        
        // Resize observer for responsive terminal
        if (window.ResizeObserver) {
            const resizeObserver = new ResizeObserver(() => {
                if (terminalData.isActive) {
                    fitAddon.fit();
                    this.updateTerminalSize(terminalId);
                }
            });
            resizeObserver.observe(terminalWrapper);
            terminalData.resizeObserver = resizeObserver;
        }
        
        this.emit('terminal_created', { terminalId, projectId, isClaudeTerminal });
        
        return terminalId;
    }
    
    setupTerminalEvents(terminal, terminalId, projectId) {
        let inputBuffer = '';
        let lastCommandSent = '';
        
        // Handle data input
        terminal.onData((data) => {
            const terminalData = this.terminals.get(terminalId);
            if (!terminalData) return;
            
            // For interactive applications like Claude Code, send all input directly to server
            // without local processing to ensure interactive prompts work correctly
            if (projectId && socket.isConnected()) {
                socket.sendTerminalInput(projectId, data);
                return;
            }
            
            // Local terminal fallback when not connected to server
            const char = data.charCodeAt(0);
            
            if (char === 13) { // Enter
                const command = inputBuffer.trim();
                
                // Always echo the newline locally first
                terminal.writeln('');
                
                if (command) {
                    // Add to history
                    terminalData.history.push(command);
                    terminalData.historyIndex = terminalData.history.length;
                    
                    // Handle local commands
                    if (this.handleLocalCommand(terminal, command, terminalId)) {
                        inputBuffer = '';
                        return;
                    }
                    
                    terminal.writeln('\x1b[31mError: Not connected to server\x1b[0m');
                } else {
                    this.writePrompt(terminal);
                }
                
                inputBuffer = '';
                
            } else if (char === 127) { // Backspace
                if (inputBuffer.length > 0) {
                    inputBuffer = inputBuffer.slice(0, -1);
                    terminal.write('\b \b'); // Local backspace handling
                }
                
            } else if (char === 27) { // Escape sequences (arrow keys, etc.)
                // Handle arrow keys for history navigation
                if (data === '\x1b[A') { // Up arrow
                    inputBuffer = this.navigateHistory(terminal, terminalData, -1, inputBuffer);
                } else if (data === '\x1b[B') { // Down arrow
                    inputBuffer = this.navigateHistory(terminal, terminalData, 1, inputBuffer);
                }
                
            } else if (char >= 32) { // Printable characters
                inputBuffer += data;
                terminal.write(data); // Local echo for immediate feedback
                
            } else {
                // Handle control characters locally when not connected
                switch (char) {
                    case 3: // Ctrl+C
                        terminal.writeln('^C');
                        this.writePrompt(terminal);
                        inputBuffer = '';
                        break;
                        
                    case 12: // Ctrl+L
                        terminal.clear();
                        this.writePrompt(terminal);
                        break;
                }
            }
        });
        
        // Store the lastCommandSent reference for this terminal
        const terminalData = this.terminals.get(terminalId);
        if (terminalData) {
            terminalData.getLastCommandSent = () => lastCommandSent;
            terminalData.clearLastCommandSent = () => { lastCommandSent = ''; };
            
            // Also store a flag to track if we've received the initial prompt
            terminalData.hasReceivedInitialPrompt = false;
        }
        
        // Handle terminal resize
        terminal.onResize((size) => {
            if (projectId && socket.isConnected()) {
                socket.resizeTerminal(projectId, size.cols, size.rows);
            }
        });
        
        // Handle selection events
        terminal.onSelectionChange(() => {
            const selection = terminal.getSelection();
            if (selection) {
                // Copy selection to clipboard automatically
                Utils.copyToClipboard(selection);
            }
        });
        
        // Don't write initial prompt when connected to server - let the shell handle its natural prompt
        if (!projectId || !socket.isConnected()) {
            this.writePrompt(terminal);
        }
    }
    
    handleLocalCommand(terminal, command, terminalId) {
        const parts = command.split(' ');
        const cmd = parts[0].toLowerCase();
        
        switch (cmd) {
            case '/help':
                this.showTerminalHelp(terminal);
                return true;
                
            case '/clear':
                terminal.clear();
                this.writePrompt(terminal);
                return true;
                
            case '/exit':
                this.closeTerminal(terminalId);
                return true;
                
            case '/status':
                this.showTerminalStatus(terminal, terminalId);
                return true;
                
                
            case '/font':
                if (parts[1]) {
                    this.setTerminalFont(terminal, parseInt(parts[1]));
                } else {
                    terminal.writeln('\r\nUsage: /font <size>');
                    this.writePrompt(terminal);
                }
                return true;
                
            default:
                return false; // Not a local command
        }
    }
    
    navigateHistory(terminal, terminalData, direction, currentInput) {
        if (terminalData.history.length === 0) return currentInput;
        
        const newIndex = terminalData.historyIndex + direction;
        
        if (newIndex >= 0 && newIndex < terminalData.history.length) {
            // Clear current input
            if (currentInput.length > 0) {
                terminal.write('\b'.repeat(currentInput.length) + ' '.repeat(currentInput.length) + '\b'.repeat(currentInput.length));
            }
            
            // Set new command
            terminalData.historyIndex = newIndex;
            const newCommand = terminalData.history[newIndex];
            terminal.write(newCommand);
            return newCommand;
            
        } else if (newIndex === terminalData.history.length) {
            // Clear to empty input
            if (currentInput.length > 0) {
                terminal.write('\b'.repeat(currentInput.length) + ' '.repeat(currentInput.length) + '\b'.repeat(currentInput.length));
            }
            
            terminalData.historyIndex = newIndex;
            return '';
        }
        
        return currentInput;
    }
    
    writePrompt(terminal) {
        terminal.write('\r\n\x1b[32m$\x1b[0m ');
    }
    
    showTerminalHelp(terminal) {
        terminal.writeln('\r\n\x1b[36mTerminal Commands:\x1b[0m');
        terminal.writeln('  /help     - Show this help message');
        terminal.writeln('  /clear    - Clear terminal screen');
        terminal.writeln('  /exit     - Close terminal');
        terminal.writeln('  /status   - Show terminal status');
        terminal.writeln('  /font     - Change font size');
        terminal.writeln('\r\n\x1b[36mKeyboard Shortcuts:\x1b[0m');
        terminal.writeln('  Ctrl+C    - Interrupt current command');
        terminal.writeln('  Ctrl+L    - Clear screen');
        terminal.writeln('  Ctrl+D    - Send EOF');
        terminal.writeln('  ↑/↓       - Navigate command history');
        terminal.writeln('  Ctrl+`    - Toggle terminal');
        this.writePrompt(terminal);
    }
    
    showTerminalStatus(terminal, terminalId) {
        const terminalData = this.terminals.get(terminalId);
        if (!terminalData) return;
        
        terminal.writeln('\r\n\x1b[36mTerminal Status:\x1b[0m');
        terminal.writeln(`  ID: ${terminalId}`);
        terminal.writeln(`  Type: ${terminalData.isClaudeTerminal ? 'Claude Code' : 'Standard'}`);
        terminal.writeln(`  Project: ${terminalData.projectId || 'None'}`);
        terminal.writeln(`  History: ${terminalData.history.length} commands`);
        terminal.writeln(`  Connection: ${socket.isConnected() ? 'Connected' : 'Disconnected'}`);
        this.writePrompt(terminal);
    }
    
    getCurrentTheme() {
        // Check if light theme is active
        if (document.body.classList.contains('theme-light')) {
            return 'light';
        }
        return 'dark'; // Default to dark theme
    }
    
    getThemeConfig(themeName) {
        const themes = {
            dark: {
                background: '#1e1e1e',
                foreground: '#d4d4d4',
                cursor: '#ffffff',
                cursorAccent: '#1e1e1e',
                selection: '#264f78',
                black: '#000000',
                red: '#cd3131',
                green: '#0dbc79',
                yellow: '#e5e510',
                blue: '#2472c8',
                magenta: '#bc3fbc',
                cyan: '#11a8cd',
                white: '#e5e5e5',
                brightBlack: '#666666',
                brightRed: '#f14c4c',
                brightGreen: '#23d18b',
                brightYellow: '#f5f543',
                brightBlue: '#3b8eea',
                brightMagenta: '#d670d6',
                brightCyan: '#29b8db',
                brightWhite: '#e5e5e5'
            },
            light: {
                background: '#ffffff',
                foreground: '#000000',
                cursor: '#000000',
                cursorAccent: '#ffffff',
                selection: '#add6ff',
                black: '#000000',
                red: '#cd3131',
                green: '#00bc00',
                yellow: '#949800',
                blue: '#0451a5',
                magenta: '#bc05bc',
                cyan: '#0598bc',
                white: '#000000',
                brightBlack: '#666666',
                brightRed: '#cd3131',
                brightGreen: '#14ce14',
                brightYellow: '#b5ba00',
                brightBlue: '#0451a5',
                brightMagenta: '#bc05bc',
                brightCyan: '#0598bc',
                brightWhite: '#a5a5a5'
            },
            'high-contrast': {
                background: '#000000',
                foreground: '#ffffff',
                cursor: '#ffffff',
                cursorAccent: '#000000',
                selection: '#ffffff',
                black: '#000000',
                red: '#ff4444',
                green: '#44ff44',
                yellow: '#ffff44',
                blue: '#6666ff',
                magenta: '#ff44ff',
                cyan: '#44ffff',
                white: '#ffffff',
                brightBlack: '#888888',
                brightRed: '#ff6666',
                brightGreen: '#66ff66',
                brightYellow: '#ffff66',
                brightBlue: '#8888ff',
                brightMagenta: '#ff66ff',
                brightCyan: '#66ffff',
                brightWhite: '#ffffff'
            },
            'solarized-dark': {
                background: '#002b36',
                foreground: '#839496',
                cursor: '#93a1a1',
                cursorAccent: '#002b36',
                selection: '#073642',
                black: '#073642',
                red: '#dc322f',
                green: '#859900',
                yellow: '#b58900',
                blue: '#268bd2',
                magenta: '#d33682',
                cyan: '#2aa198',
                white: '#eee8d5',
                brightBlack: '#002b36',
                brightRed: '#cb4b16',
                brightGreen: '#586e75',
                brightYellow: '#657b83',
                brightBlue: '#839496',
                brightMagenta: '#6c71c4',
                brightCyan: '#93a1a1',
                brightWhite: '#fdf6e3'
            },
            'solarized-light': {
                background: '#fdf6e3',
                foreground: '#657b83',
                cursor: '#586e75',
                cursorAccent: '#fdf6e3',
                selection: '#eee8d5',
                black: '#073642',
                red: '#dc322f',
                green: '#859900',
                yellow: '#b58900',
                blue: '#268bd2',
                magenta: '#d33682',
                cyan: '#2aa198',
                white: '#eee8d5',
                brightBlack: '#002b36',
                brightRed: '#cb4b16',
                brightGreen: '#586e75',
                brightYellow: '#657b83',
                brightBlue: '#839496',
                brightMagenta: '#6c71c4',
                brightCyan: '#93a1a1',
                brightWhite: '#fdf6e3'
            },
            monokai: {
                background: '#272822',
                foreground: '#f8f8f2',
                cursor: '#f8f8f2',
                cursorAccent: '#272822',
                selection: '#49483e',
                black: '#272822',
                red: '#f92672',
                green: '#a6e22e',
                yellow: '#f4bf75',
                blue: '#66d9ef',
                magenta: '#ae81ff',
                cyan: '#a1efe4',
                white: '#f8f8f2',
                brightBlack: '#75715e',
                brightRed: '#f92672',
                brightGreen: '#a6e22e',
                brightYellow: '#f4bf75',
                brightBlue: '#66d9ef',
                brightMagenta: '#ae81ff',
                brightCyan: '#a1efe4',
                brightWhite: '#f9f8f5'
            }
        };
        return themes[themeName] || themes.dark;
    }

    
    setTerminalFont(terminal, fontSize) {
        if (fontSize >= 8 && fontSize <= 32) {
            terminal.options.fontSize = fontSize;
            terminal.writeln(`\r\nFont size changed to: ${fontSize}px`);
            Storage.set('terminal-font-size', fontSize);
            
            // Refit terminal
            const terminalData = this.terminals.get(this.activeTerminal);
            if (terminalData && terminalData.fitAddon) {
                terminalData.fitAddon.fit();
            }
        } else {
            terminal.writeln('\r\nFont size must be between 8 and 32');
        }
        this.writePrompt(terminal);
    }
    
    createTerminalTab(terminalId, projectId, isClaudeTerminal) {
        const tab = DOM.create('button', {
            className: 'terminal-tab',
            attributes: { 'data-terminal-id': terminalId }
        });
        
        const icon = DOM.create('span', {
            className: 'icon',
            text: isClaudeTerminal ? '🤖' : '💻'
        });
        
        const title = DOM.create('span', {
            className: 'title',
            text: projectId ? `${projectId}` : `Terminal ${this.terminalCounter}`
        });
        
        const closeBtn = DOM.create('button', {
            className: 'close-btn',
            text: '×',
            events: {
                click: (e) => {
                    e.stopPropagation();
                    this.closeTerminal(terminalId);
                }
            }
        });
        
        tab.appendChild(icon);
        tab.appendChild(title);
        tab.appendChild(closeBtn);
        
        // Tab click handler
        DOM.on(tab, 'click', () => {
            this.setActiveTerminal(terminalId);
        });
        
        this.tabsContainer.appendChild(tab);
        
        return tab;
    }
    
    createStatusBar(terminalId, projectId) {
        const statusBar = DOM.create('div', {
            className: 'terminal-status'
        });
        
        const statusLeft = DOM.create('div', {
            className: 'terminal-status-left'
        });
        
        const statusRight = DOM.create('div', {
            className: 'terminal-status-right'
        });
        
        // Left side status items
        const connectionStatus = DOM.create('div', {
            className: 'terminal-status-item',
            id: `connection-${terminalId}`
        });
        
        const connectionIcon = DOM.create('span', {
            className: 'icon',
            text: '🔗'
        });
        
        const connectionText = DOM.create('span', {
            text: socket.isConnected() ? 'Connected' : 'Disconnected'
        });
        
        connectionStatus.appendChild(connectionIcon);
        connectionStatus.appendChild(connectionText);
        statusLeft.appendChild(connectionStatus);
        
        if (projectId) {
            const projectStatus = DOM.create('div', {
                className: 'terminal-status-item',
                id: `project-${terminalId}`
            });
            
            const projectIcon = DOM.create('span', {
                className: 'icon',
                text: '📁'
            });
            
            const projectText = DOM.create('span', {
                text: projectId
            });
            
            projectStatus.appendChild(projectIcon);
            projectStatus.appendChild(projectText);
            statusLeft.appendChild(projectStatus);
        }
        
        // Right side status items
        const timeStatus = DOM.create('div', {
            className: 'terminal-status-item',
            id: `time-${terminalId}`
        });
        
        const timeIcon = DOM.create('span', {
            className: 'icon',
            text: '🕐'
        });
        
        const timeText = DOM.create('span', {
            text: new Date().toLocaleTimeString()
        });
        
        timeStatus.appendChild(timeIcon);
        timeStatus.appendChild(timeText);
        statusRight.appendChild(timeStatus);
        
        statusBar.appendChild(statusLeft);
        statusBar.appendChild(statusRight);
        
        // Update time every second
        setInterval(() => {
            timeText.textContent = new Date().toLocaleTimeString();
        }, 1000);
        
        return statusBar;
    }
    
    setActiveTerminal(terminalId) {
        // Deactivate current terminal
        if (this.activeTerminal) {
            const currentData = this.terminals.get(this.activeTerminal);
            if (currentData) {
                currentData.isActive = false;
                DOM.removeClass(currentData.element, 'active');
                DOM.removeClass(currentData.tab, 'active');
            }
        }
        
        // Activate new terminal
        const terminalData = this.terminals.get(terminalId);
        if (terminalData) {
            this.activeTerminal = terminalId;
            terminalData.isActive = true;
            DOM.addClass(terminalData.element, 'active');
            DOM.addClass(terminalData.tab, 'active');
            
            // Fit and focus terminal
            terminalData.fitAddon.fit();
            terminalData.terminal.focus();
            
            // Sync project selection when terminal is activated
            if (terminalData.projectId && window.projectManager) {
                const currentProject = window.projectManager.getCurrentProject();
                if (!currentProject || currentProject.id !== terminalData.projectId) {
                    window.projectManager.selectProject(terminalData.projectId);
                }
            }
            
            this.emit('terminal_activated', { terminalId });
        }
    }
    
    closeTerminal(terminalId) {
        const terminalData = this.terminals.get(terminalId);
        if (!terminalData) return;
        
        // Clean up
        if (terminalData.resizeObserver) {
            terminalData.resizeObserver.disconnect();
        }
        
        terminalData.terminal.dispose();
        
        // Remove elements
        if (terminalData.element.parentNode) {
            terminalData.element.parentNode.removeChild(terminalData.element);
        }
        
        if (terminalData.tab.parentNode) {
            terminalData.tab.parentNode.removeChild(terminalData.tab);
        }
        
        // Remove from map
        this.terminals.delete(terminalId);
        
        // If this was the active terminal, switch to another
        if (this.activeTerminal === terminalId) {
            this.activeTerminal = null;
            
            // Find another terminal to activate
            const remainingTerminals = Array.from(this.terminals.keys());
            if (remainingTerminals.length > 0) {
                this.setActiveTerminal(remainingTerminals[0]);
            } else {
                // Show welcome screen if no terminals left
                if (this.welcomeScreen) {
                    DOM.show(this.welcomeScreen);
                }
            }
        }
        
        this.emit('terminal_closed', { terminalId });
    }
    
    clearActiveTerminal() {
        if (this.activeTerminal) {
            const terminalData = this.terminals.get(this.activeTerminal);
            if (terminalData) {
                terminalData.terminal.clear();
                this.writePrompt(terminalData.terminal);
            }
        }
    }
    
    updateTerminalSize(terminalId) {
        const terminalData = this.terminals.get(terminalId);
        if (terminalData && terminalData.projectId && socket.isConnected()) {
            const { cols, rows } = terminalData.terminal;
            socket.resizeTerminal(terminalData.projectId, cols, rows);
        }
    }
    
    toggleTerminal() {
        const terminalContainer = DOM.get('terminal-container');
        if (terminalContainer) {
            DOM.toggleClass(terminalContainer, 'collapsed');
        }
    }
    
    switchToNextTerminal() {
        const terminalIds = Array.from(this.terminals.keys());
        const currentIndex = terminalIds.indexOf(this.activeTerminal);
        const nextIndex = (currentIndex + 1) % terminalIds.length;
        
        if (terminalIds[nextIndex]) {
            this.setActiveTerminal(terminalIds[nextIndex]);
        }
    }
    
    switchToPreviousTerminal() {
        const terminalIds = Array.from(this.terminals.keys());
        const currentIndex = terminalIds.indexOf(this.activeTerminal);
        const prevIndex = currentIndex === 0 ? terminalIds.length - 1 : currentIndex - 1;
        
        if (terminalIds[prevIndex]) {
            this.setActiveTerminal(terminalIds[prevIndex]);
        }
    }
    
    switchToTerminal(index) {
        const terminalIds = Array.from(this.terminals.keys());
        if (terminalIds[index]) {
            this.setActiveTerminal(terminalIds[index]);
        }
    }
    
    splitTerminal() {
        if (this.activeTerminal) {
            const terminalData = this.terminals.get(this.activeTerminal);
            if (terminalData) {
                this.createTerminal(terminalData.projectId);
            }
        } else {
            this.createTerminal();
        }
    }
    
    showTerminalSettings() {
        // Open terminal settings modal with terminal tab active
        if (window.app && window.app.showSettings) {
            window.app.showSettings('terminal');
        } else {
            modals.open('settings-modal');
            // Use setTimeout to ensure DOM is ready
            setTimeout(() => {
                DOM.query('.settings-tab[data-tab="terminal"]')?.click();
            }, 100);
        }
    }
    
    // Socket event handlers
    handleTerminalOutput(data) {
        const { projectId, data: output } = data;
        
        // Find terminal for this project
        for (const [terminalId, terminalData] of this.terminals.entries()) {
            if (terminalData.projectId === projectId) {
                // Write output directly without filtering to preserve interactive application behavior
                terminalData.terminal.write(output);
                break;
            }
        }
    }
    
    // Helper function to escape special regex characters
    escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
    handleClaudeResponse(data) {
        const { projectId, data: response, type } = data;
        
        // Find Claude terminal for this project
        for (const [terminalId, terminalData] of this.terminals.entries()) {
            if (terminalData.projectId === projectId && terminalData.isClaudeTerminal) {
                if (type === 'command_sent') {
                    terminalData.terminal.writeln('\r\n\x1b[36mCommand sent to Claude\x1b[0m');
                } else {
                    terminalData.terminal.write(response);
                }
                // Don't write prompt, let server handle it
                // this.writePrompt(terminalData.terminal);
                break;
            }
        }
    }
    
    handleProjectStatus(data) {
        const { projectId, status } = data;
        
        // Update terminal status based on project status
        for (const [terminalId, terminalData] of this.terminals.entries()) {
            if (terminalData.projectId === projectId) {
                this.updateTerminalProjectStatus(terminalData, status);
            }
        }
    }
    
    updateTerminalProjectStatus(terminalData, status) {
        const statusElement = terminalData.statusBar.querySelector(`#project-${terminalData.id}`);
        if (statusElement) {
            DOM.removeClass(statusElement, 'success', 'warning', 'error');
            
            switch (status) {
                case 'claude_started':
                    DOM.addClass(statusElement, 'success');
                    terminalData.terminal.writeln('\r\n\x1b[32mClaude session started\x1b[0m');
                    // this.writePrompt(terminalData.terminal);
                    break;
                case 'claude_stopped':
                    DOM.removeClass(statusElement, 'success', 'warning', 'error');
                    terminalData.terminal.writeln('\r\n\x1b[33mClaude session stopped\x1b[0m');
                    // this.writePrompt(terminalData.terminal);
                    break;
                case 'terminal_created':
                    DOM.addClass(statusElement, 'success');
                    break;
                case 'terminal_destroyed':
                    DOM.addClass(statusElement, 'error');
                    break;
            }
        }
    }
    
    // Public API methods
    getActiveTerminal() {
        return this.activeTerminal ? this.terminals.get(this.activeTerminal) : null;
    }
    
    getTerminal(terminalId) {
        return this.terminals.get(terminalId);
    }
    
    getAllTerminals() {
        return Array.from(this.terminals.values());
    }
    
    getTerminalsByProject(projectId) {
        return Array.from(this.terminals.values()).filter(t => t.projectId === projectId);
    }
    
    hasTerminalsForProject(projectId) {
        return this.getTerminalsByProject(projectId).length > 0;
    }
    
    createTerminalForProject(projectId, isClaudeTerminal = false) {
        return this.createTerminal(projectId, { isClaudeTerminal });
    }
    
    closeTerminalsForProject(projectId) {
        const terminals = this.getTerminalsByProject(projectId);
        terminals.forEach(terminalData => {
            this.closeTerminal(terminalData.id);
        });
    }
}

// Initialize terminal manager
const terminalManager = new TerminalManager();

// Make terminal manager globally available
window.terminalManager = terminalManager;

// Export for other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TerminalManager };
}
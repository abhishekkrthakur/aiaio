// Global state management
const state = {
    ws: null,
    isInitializingSettings: false,
    currentSettings: null,
    originalSettings: null,
    isScrolledManually: false,
    lastScrollTop: 0,
    currentAssistantMessage: null,
    currentConversationId: null,
    isLoading: false,
    currentPrompt: null,
    isPromptEditing: false,
    editingPromptId: null,
    originalPromptText: '',
    isPromptEdited: false
};

// DOM Elements
const elements = {
    chatForm: document.getElementById('chat-form'),
    messageInput: document.getElementById('message-input'),
    chatMessages: document.getElementById('chat-messages'),
    jumpToBottomButton: document.getElementById('jump-to-bottom'),
    systemPrompt: document.getElementById('system-prompt'),
    fileInput: document.getElementById('file-input'),
    filePreviewContainer: document.getElementById('file-preview-container'),
    sendButton: document.getElementById('send-button')
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeCore();
    initializeEventListeners();
}, { once: true });

function initializeCore() {
    loadConversations();
    updateSystemPrompt();
    startNewConversation();
    connectWebSocket();
    initializeSettings();
    loadVersion();
    loadPrompts();
}

function initializeEventListeners() {
    elements.chatMessages.addEventListener('scroll', handleScroll);
    document.getElementById('prompt-selector')?.addEventListener('change', handlePromptChange);
    elements.systemPrompt.addEventListener('input', handlePromptTextChange);
    document.getElementById('save-prompt-button').addEventListener('click', savePromptChanges);
    document.getElementById('new-conversation-btn')?.addEventListener('click', startNewConversation);
    
    // Handle visibility change
    document.addEventListener('visibilitychange', handleVisibilityChange);
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp * 1000);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} ${date.toLocaleTimeString()}`;
}

function scrollToBottom() {
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    state.isScrolledManually = false;
    elements.jumpToBottomButton.classList.remove('visible');
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(() => showCopiedFeedback(event.target))
        .catch(err => console.error('Failed to copy:', err));
}

function showCopiedFeedback(button) {
    const originalText = button.textContent;
    button.textContent = 'Copied!';
    setTimeout(() => {
        button.textContent = originalText;
    }, 2000);
}

// Error handling
function handleError(error, context) {
    console.error(`Error in ${context}:`, error);
    // You could add more sophisticated error handling here
}

function connectWebSocket() {
    // Use secure WebSocket if the page is served over HTTPS
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    state.ws = new WebSocket(wsUrl);

    state.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };

    state.ws.onclose = () => {
        // Reconnect after a delay
        setTimeout(connectWebSocket, 3000);
    };

    // Send keepalive message every 30 seconds
    const keepAliveInterval = setInterval(() => {
        if (state.ws.readyState === WebSocket.OPEN) {
            state.ws.send('keepalive');
        }
    }, 30000);

    state.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'conversation_created':
        case 'conversation_deleted':
        case 'message_added':
            // Always update the conversations list to reflect changes
            loadConversations();
            
            // Additional handling for current conversation
            if (data.type === 'message_added' && state.currentConversationId === data.conversation_id) {
                loadConversation(data.conversation_id);
            } else if (data.type === 'conversation_deleted' && state.currentConversationId === data.conversation_id) {
                startNewConversation();
            }
            break;
        
        case 'summary_updated':
            // Find and update the specific conversation's summary
            const conversationElement = document.querySelector(`[data-conversation-id="${data.conversation_id}"]`);
            if (conversationElement) {
                const summaryElement = conversationElement.querySelector('.text-[10px].text-gray-600');
                if (summaryElement) {
                    summaryElement.textContent = data.summary || 'No summary';
                }
            }
            break;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadConversations();
    updateSystemPrompt(); // Replace loadSystemPrompt with updateSystemPrompt
    startNewConversation();
    connectWebSocket(); // Replace startPolling() with WebSocket connection
    initializeSettings(); // Changed from loadSettings
    loadVersion(); // Add this line
    
    // Add new conversation button event listener here
    document.getElementById('new-conversation-btn')?.addEventListener('click', startNewConversation);
    
    // Initialize scroll handling
    elements.chatMessages.addEventListener('scroll', handleScroll);
    handleScroll(); // Check initial scroll position

    // Add prompt selector event listener
    document.getElementById('prompt-selector')?.addEventListener('change', handlePromptChange);
    
    // Initialize prompts
    loadPrompts();
    
    // Add event listeners for prompt editing
    document.getElementById('system-prompt').addEventListener('input', handlePromptTextChange);
    document.getElementById('save-prompt-button').addEventListener('click', savePromptChanges);
}, { once: true });

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Optional: You could close the WebSocket here if desired
    } else {
        // Ensure we have a connection when page becomes visible
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
            connectWebSocket();
        }
        loadConversations(); // One-time refresh when returning to the page
    }
});

async function loadConversations() {
    if (state.isLoading) return;
    
    try {
        state.isLoading = true;
        const response = await fetch('/conversations');
        const data = await response.json();
        const conversationsList = document.getElementById('conversations-list');
        
        // Sort conversations by last_updated timestamp (newest first)
        data.conversations.sort((a, b) => b.last_updated - a.last_updated);
        
        // Only update DOM if there are changes
        const currentConvs = conversationsList.innerHTML;
        const newConvs = data.conversations.map(conv => {
            const lastUpdated = formatTimestamp(conv.last_updated);
            return `
                <div class="group w-full px-3 py-2 text-sm rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-200 cursor-pointer mb-2 relative" 
                     onclick="loadConversation('${conv.conversation_id}')"
                     data-conversation-id="${conv.conversation_id}">
                    <div class="text-xs text-gray-600 dark:text-gray-300 italic overflow-hidden text-ellipsis">
                        ${conv.summary || 'No summary'}
                    </div>
                    <div class="text-[10px] text-gray-500 dark:text-gray-400">
                        ${lastUpdated}
                    </div>
                    <button onclick="deleteConversation('${conv.conversation_id}', event)"
                            class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-red-500 rounded-full hover:bg-gray-300 dark:hover:bg-gray-600 transition-all duration-200">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            `;
        }).join('');
        
        if (currentConvs !== newConvs) {
            conversationsList.innerHTML = newConvs;
        }
    } catch (error) {
        console.error('Error loading conversations:', error);
    } finally {
        state.isLoading = false;
    }
}

async function updateSystemPrompt() {
    try {
        await loadPrompts(); // Load all available prompts
        const response = await fetch(`/get_system_prompt?conversation_id=${state.currentConversationId || ''}`);
        const data = await response.json();
        elements.systemPrompt.value = data.system_prompt;
    } catch (error) {
        console.error('Error fetching system prompt:', error);
    }
}

async function loadConversation(conversationId) {
    try {
        state.currentConversationId = conversationId;
        const response = await fetch(`/conversations/${conversationId}`);
        const data = await response.json();
        // Clear current chat
        elements.chatMessages.innerHTML = '';
        
        // Set current conversation ID
        state.currentConversationId = conversationId;
        
        // Display messages
        for (const msg of data.messages) {
            if (msg.role === 'user') {
                appendUserMessage(msg.content);
            } else if (msg.role === 'assistant') {
                state.currentAssistantMessage = createAssistantMessage();
                updateAssistantMessage(msg.content);
                state.currentAssistantMessage = null;
            }
        }

        // Fetch and update system prompt for the loaded conversation
        await updateSystemPrompt();
        
        // Reset scroll state
        state.isScrolledManually = false;
        
        // Use setTimeout to ensure all content is rendered before scrolling
        setTimeout(() => {
            scrollToBottom();
        }, 100);
    } catch (error) {
        console.error('Error loading conversation:', error);
    }
}

async function createNewConversation() {
    try {
        const createResponse = await fetch('/create_conversation', { method: 'POST' });
        const data = await createResponse.json();
        state.currentConversationId = data.conversation_id;
        loadConversations();

        // Reset system prompt by fetching default from API
        await updateSystemPrompt();
    } catch (error) {
        console.error('Error creating conversation:', error);
    }
}

// Add function to start new conversation
async function startNewConversation() {
    elements.chatMessages.innerHTML = '';
    state.currentConversationId = null;
    elements.messageInput.value = '';
    elements.fileInput.value = '';
    elements.filePreviewContainer.innerHTML = '';
    elements.filePreviewContainer.classList.add('hidden');
    await updateSystemPrompt(); // Fetch system prompt for new conversation
}

// Load conversations when page loads
document.addEventListener('DOMContentLoaded', () => {
    loadConversations();
    updateSystemPrompt(); // Replace loadSystemPrompt with updateSystemPrompt
    startNewConversation(); // Ensure we start with a new conversation
});

function appendUserMessage(content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-bubble user-message';
    messageDiv.textContent = content;
    elements.chatMessages.appendChild(messageDiv);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function createAssistantMessage() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-bubble assistant-message';
    elements.chatMessages.appendChild(messageDiv);
    
    // Only scroll to bottom if we haven't manually scrolled up
    if (!state.isScrolledManually) {
        scrollToBottom();
    }
    return messageDiv;
}

function updateAssistantMessage(content) {
    if (!state.currentAssistantMessage) {
        state.currentAssistantMessage = createAssistantMessage();
    }

    const wasAtBottom = Math.abs(
        (elements.chatMessages.scrollHeight - elements.chatMessages.clientHeight) - elements.chatMessages.scrollTop
    ) < 10;

    // Configure marked options
    marked.setOptions({
        gfm: true,
        breaks: true,
        headerIds: false,
        mangle: false,
        highlight: function(code, language) {
            if (language && hljs.getLanguage(language)) {
                try {
                    return hljs.highlight(code, { language }).value;
                } catch (err) {}
            }
            return code;
        }
    });

    // Clean up any existing highlights before updating
    const existingHighlights = state.currentAssistantMessage.querySelectorAll('pre code');
    existingHighlights.forEach(block => {
        block.parentElement.removeChild(block);
    });

    // Parse and update content
    let parsedContent = marked.parse(content);
    
    // Ensure code blocks are properly wrapped
    parsedContent = parsedContent.replace(
        /<pre><code class="(.*?)">/g, 
        '<pre><code class="hljs $1">'
    );

    state.currentAssistantMessage.innerHTML = parsedContent;

    // Re-apply syntax highlighting to all code blocks
    state.currentAssistantMessage.querySelectorAll('pre code').forEach(block => {
        // Remove any previous copy buttons
        const pre = block.parentNode;
        const oldButton = pre.querySelector('.copy-button');
        if (oldButton) {
            pre.removeChild(oldButton);
        }

        // Apply fresh syntax highlighting
        hljs.highlightElement(block);
        
        // Add new copy button
        const copyButton = document.createElement('button');
        copyButton.className = 'copy-button';
        copyButton.textContent = 'Copy';
        copyButton.onclick = (e) => {
            e.preventDefault();
            copyToClipboard(block.textContent);
        };
        pre.appendChild(copyButton);
    });

    if (wasAtBottom && !state.isScrolledManually) {
        scrollToBottom();
    } else if (!wasAtBottom) {
        elements.jumpToBottomButton.classList.add('visible');
    }
}

// Add this new event listener for Enter key
elements.messageInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        elements.chatForm.requestSubmit();
    }
});

elements.chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = elements.messageInput.value.trim();
    const files = elements.fileInput.files;
    
    if (!message && !files.length) return;

    elements.messageInput.value = '';
    elements.sendButton.disabled = true;
    
    try {
        if (!state.currentConversationId) {
            const createResponse = await fetch('/create_conversation', { method: 'POST' });
            const data = await createResponse.json();
            
            state.currentConversationId = data.conversation_id;
            loadConversations();
        }

        appendUserMessage(message);
        
        // Clear file previews
        elements.filePreviewContainer.innerHTML = '';
        elements.filePreviewContainer.classList.add('hidden');
        
        // Create FormData and append all data
        const formData = new FormData();
        formData.append('message', message);
        formData.append('system_prompt', elements.systemPrompt.value.trim() || 'You are a helpful assistant');
        formData.append('conversation_id', state.currentConversationId);
        
        Array.from(files).forEach(file => {
            formData.append('files', file);
        });

        elements.fileInput.value = '';

        // Create assistant message bubble immediately
        state.currentAssistantMessage = createAssistantMessage();
        let responseText = '';

        const response = await fetch('/chat', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let isFirstChunk = true;
        while (true) {
            const {value, done} = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            responseText += chunk;

            // Only scroll to bottom on first chunk if we're already at bottom
            if (isFirstChunk) {
                const isAtBottom = Math.abs(
                    (elements.chatMessages.scrollHeight - elements.chatMessages.clientHeight) - elements.chatMessages.scrollTop
                ) < 10;
                state.isScrolledManually = !isAtBottom;
                isFirstChunk = false;
            }
            
            // Update the message with the accumulated text
            updateAssistantMessage(responseText);
            
            // Only auto-scroll if user hasn't scrolled up
            if (!state.isScrolledManually) {
                scrollToBottom();
            }
        }

    } catch (error) {
        console.error('Error:', error);
        state.currentAssistantMessage = null;
        appendMessage('Sorry, something went wrong. ' + error.message, 'assistant');
    } finally {
        elements.sendButton.disabled = false;
        
        // After streaming is complete, check if we should show jump-to-bottom button
        const isAtBottom = Math.abs(
            (elements.chatMessages.scrollHeight - elements.chatMessages.clientHeight) - elements.chatMessages.scrollTop
        ) < 10;
        if (!isAtBottom) {
            elements.jumpToBottomButton.classList.add('visible');
        }
    }
});

elements.fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    const previewContainer = elements.filePreviewContainer;
    previewContainer.innerHTML = '';
    uploadedFiles = [];

    for (const file of files) {
        const reader = new FileReader();
        
        reader.onload = async (e) => {
            const fileData = e.target.result;
            uploadedFiles.push({
                name: file.name,
                type: file.type,
                data: fileData
            });

            const previewDiv = document.createElement('div');
            previewDiv.className = 'flex items-center gap-2 p-2 bg-gray-100 dark:bg-gray-700 rounded';

            if (file.type.startsWith('image/')) {
                const img = document.createElement('img');
                img.src = fileData;
                img.className = 'w-12 h-12 object-cover rounded';
                previewDiv.appendChild(img);
            } else {
                const icon = document.createElement('div');
                icon.className = 'w-12 h-12 flex items-center justify-center bg-gray-200 dark:bg-gray-600 rounded';
                icon.innerHTML = '📎';
                previewDiv.appendChild(icon);
            }

            const nameSpan = document.createElement('span');
            nameSpan.className = 'flex-1 truncate text-sm';
            nameSpan.textContent = file.name;
            previewDiv.appendChild(nameSpan);

            const removeButton = document.createElement('button');
            removeButton.className = 'p-1 text-gray-500 hover:text-red-500';
            removeButton.innerHTML = '×';
            removeButton.onclick = () => {
                previewDiv.remove();
                uploadedFiles = uploadedFiles.filter(f => f.name !== file.name);
                if (uploadedFiles.length === 0) {
                    previewContainer.classList.add('hidden');
                }
            };
            previewDiv.appendChild(removeButton);

            previewContainer.appendChild(previewDiv);
        };

        if (file.type.startsWith('image/')) {
            reader.readAsDataURL(file);
        } else {
            reader.readAsText(file);
        }
    }

    if (files.length > 0) {
        previewContainer.classList.remove('hidden');
    }
});

async function deleteConversation(conversationId, event) {
    event.stopPropagation(); // Prevent triggering the conversation load
    if (!confirm('Are you sure you want to delete this conversation?')) return;
    
    try {
        const response = await fetch(`/conversations/${conversationId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            // If we're currently viewing this conversation, start a new one
            if (state.currentConversationId === conversationId) {
                startNewConversation();
            }
            await loadConversations(); // Refresh the list
        } else {
            alert('Failed to delete conversation');
        }
    } catch (error) {
        console.error('Error deleting conversation:', error);
        alert('Error deleting conversation');
    }
}

async function loadVersion() {
    try {
        const response = await fetch('/version');
        const data = await response.json();
        document.getElementById('version-display').textContent = `version: ${data.version}`;
    } catch (error) {
        console.error('Error loading version:', error);
        document.getElementById('version-display').textContent = 'version: unknown';
    }
}

// Add this function to handle scrolling
function handleScroll() {
    const currentScrollTop = elements.chatMessages.scrollTop;
    const maxScroll = elements.chatMessages.scrollHeight - elements.chatMessages.clientHeight;
    const isAtBottom = Math.abs(maxScroll - currentScrollTop) < 10;
    
    // Only set isScrolledManually if user is scrolling up
    if (currentScrollTop < state.lastScrollTop && !isAtBottom) {
        state.isScrolledManually = true;
    }
    
    // Show/hide jump to bottom button
    if (!isAtBottom) {
        elements.jumpToBottomButton.classList.add('visible');
    } else {
        elements.jumpToBottomButton.classList.remove('visible');
        state.isScrolledManually = false;
    }
    
    state.lastScrollTop = currentScrollTop;
}

// Add scroll event listener
elements.chatMessages.addEventListener('scroll', handleScroll);

// Update scrollToBottom function
function scrollToBottom() {
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    state.isScrolledManually = false;
    elements.jumpToBottomButton.classList.remove('visible');
}

// Update your message handling functions to respect manual scrolling
function appendMessage(role, content) {
    // ...existing message appending code...
    
    // Only auto-scroll if user hasn't scrolled manually
    if (!state.isScrolledManually) {
        scrollToBottom();
    }
}

// Update your streaming response handler
async function handleStream(response) {    
    try {
        const reader = response.body.getReader();
        let partialMessage = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
                        
            // Only auto-scroll if user hasn't scrolled manually
            if (!state.isScrolledManually) {
                scrollToBottom();
            }
        }
    } catch (error) {
        console.error('Error reading stream:', error);
    }
}

// Initialize settings panel
async function initializeSettings() {
    if (state.isInitializingSettings) return;
    try {
        state.isInitializingSettings = true;
        
        // Get all available settings
        const response = await fetch('/settings/all');
        if (!response.ok) throw new Error('Failed to fetch settings');
        
        const data = await response.json();
        const selector = document.getElementById('settings-selector');
        
        // Clear existing options
        while (selector.firstChild) {
            selector.removeChild(selector.firstChild);
        }
        
        // Get default settings to mark as selected
        const defaultResponse = await fetch('/settings');
        if (!defaultResponse.ok) throw new Error('Failed to fetch default settings');
        const defaultSettings = await defaultResponse.json();
        
        // Create a Map to track unique settings by ID
        const uniqueSettings = new Map();
        
        // Add unique settings to the Map
        if (data.settings && Array.isArray(data.settings)) {
            data.settings.forEach(setting => {
                // Only add if we haven't seen this ID before and the setting has a valid ID
                if (setting && setting.id && !uniqueSettings.has(setting.id)) {
                    uniqueSettings.set(setting.id, setting);
                }
            });
        }
        
        // Remove any existing change listener to prevent duplicates
        const oldSelector = selector.cloneNode(false);
        selector.parentNode.replaceChild(oldSelector, selector);
        
        // Convert Map values to array and sort by name
        const sortedSettings = Array.from(uniqueSettings.values())
            .sort((a, b) => a.name.localeCompare(b.name));
        
        // Populate selector with unique settings
        sortedSettings.forEach(setting => {
            const option = document.createElement('option');
            option.value = setting.id;
            option.textContent = setting.name;
            option.selected = setting.id === defaultSettings.id;
            oldSelector.appendChild(option);
        });
        
        // Add new change listener
        oldSelector.addEventListener('change', (e) => loadSettingsConfig(e.target.value));
        
        // Load selected settings if any options were added
        if (oldSelector.options.length > 0) {
            await loadSettingsConfig(oldSelector.value);
        }
        
        // Add input listeners for change detection
        addSettingsChangeListeners();
        
    } catch (error) {
        console.error('Failed to initialize settings:', error);
        alert('Error loading settings configurations');
    } finally {
        state.isInitializingSettings = false;
    }
}

// Update loadSettingsConfig to automatically set selected as default
async function loadSettingsConfig(id) {
    try {
        const response = await fetch(`/settings/${id}`);
        if (!response.ok) throw new Error('Failed to fetch settings config');
        
        const settings = await response.json();
        updateSettingsForm(settings);
        
        // Store current and original settings
        state.currentSettings = settings;
        state.originalSettings = {...settings};
        
        // Set this configuration as default automatically
        await fetch(`/settings/${id}/set_default`, { method: 'POST' });
        
        // Hide warning
        document.getElementById('settings-warning').classList.add('hidden');
        
    } catch (error) {
        console.error('Failed to load settings config:', error);
        alert('Error loading settings configuration');
    }
}

// Update form with settings values
function updateSettingsForm(settings) {
    document.getElementById('config-name').value = settings.name || '';
    document.getElementById('temperature').value = settings.temperature || 1.0;
    document.getElementById('temperature-value').textContent = settings.temperature || 1.0;
    document.getElementById('top-p').value = settings.top_p || 0.95;
    document.getElementById('top-p-value').textContent = settings.top_p || 0.95;
    document.getElementById('max-tokens').value = settings.max_tokens || 4096;
    document.getElementById('api-host').value = settings.host || '';
    document.getElementById('model-name').value = settings.model_name || '';
    document.getElementById('api-key').value = settings.api_key || '';
}

// Create new settings configuration
async function createNewSettingsConfig() {
    openSettingsModal();
}

// Update saveSettings function to remove default toggle handling
async function saveSettings() {
    const saveButton = document.getElementById('settings-warning')?.querySelector('button');
    if (saveButton) {
        saveButton.disabled = true;
    }
    
    try {
        const settings = {
            name: document.getElementById('config-name').value.trim(),
            temperature: parseFloat(document.getElementById('temperature').value),
            top_p: parseFloat(document.getElementById('top-p').value),
            max_tokens: parseInt(document.getElementById('max-tokens').value),
            host: document.getElementById('api-host').value.trim(),
            model_name: document.getElementById('model-name').value.trim(),
            api_key: document.getElementById('api-key').value.trim()
        };
        
        if (!settings.name) {
            alert('Configuration name is required');
            return;
        }

        let response;
        let result;
        
        // If this is a new configuration
        if (state.currentSettings.id === 'new') {
            response = await fetch('/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
        } else {
            // Update existing configuration
            settings.id = state.currentSettings.id;
            response = await fetch(`/settings/${settings.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
        }
        
        if (!response.ok) {
            throw new Error('Failed to save settings');
        }
        
        result = await response.json();
        
        // For new settings, we need the ID from the response
        const settingsId = state.currentSettings.id === 'new' ? result.id : settings.id;
        
        // Set as default automatically
        const defaultResponse = await fetch(`/settings/${settingsId}/set_default`, {
            method: 'POST'
        });
        
        if (!defaultResponse.ok) {
            throw new Error('Failed to set as default');
        }

        // Update the current settings state
        state.currentSettings = {
            ...settings,
            id: settingsId
        };
        state.originalSettings = {...state.currentSettings};
        
        // Hide the warning since we just saved
        document.getElementById('settings-warning').classList.add('hidden');
        
        // Refresh the settings list and reselect current settings
        await initializeSettings();
        document.getElementById('settings-selector').value = settingsId;
        
        // Show success feedback
        const successNotification = document.createElement('div');
        successNotification.className = 'fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50 flex items-center gap-2 animate-fade-in';
        successNotification.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <span>Settings saved successfully</span>
        `;
        
        document.body.appendChild(successNotification);
        
        // Add fade out animation
        setTimeout(() => {
            successNotification.classList.add('opacity-0', 'transform', 'translate-y-[-1rem]');
            successNotification.style.transition = 'all 0.5s ease-out';
        }, 1500);
        
        // Remove the notification after animation
        setTimeout(() => {
            successNotification.remove();
        }, 2000);
        
    } catch (error) {
        console.error('Failed to save settings:', error);
        
        // Show error notification
        const errorNotification = document.createElement('div');
        errorNotification.className = 'fixed top-4 right-4 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg z-50 flex items-center gap-2 animate-fade-in';
        errorNotification.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span>Error saving settings: ${error.message}</span>
        `;
        
        document.body.appendChild(errorNotification);
        
        setTimeout(() => {
            errorNotification.classList.add('opacity-0', 'transform', 'translate-y-[-1rem]');
            errorNotification.style.transition = 'all 0.5s ease-out';
        }, 3000);
        
        setTimeout(() => {
            errorNotification.remove();
        }, 3500);
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
        }
    }
}

// Update addSettingsChangeListeners to remove default-config-toggle
function addSettingsChangeListeners() {
    const inputs = [
        'config-name', 'temperature', 'top-p', 'max-tokens',
        'api-host', 'model-name', 'api-key'
    ];
    
    inputs.forEach(id => {
        document.getElementById(id).addEventListener('input', checkSettingsChanged);
    });
}

// Check if settings have changed
function checkSettingsChanged() {
    if (!state.originalSettings) return;
    
    const current = {
        id: document.getElementById('settings-selector').value,
        name: document.getElementById('config-name').value.trim(),
        temperature: parseFloat(document.getElementById('temperature').value),
        top_p: parseFloat(document.getElementById('top-p').value),
        max_tokens: parseInt(document.getElementById('max-tokens').value),
        host: document.getElementById('api-host').value.trim(),
        model_name: document.getElementById('model-name').value.trim(),
        api_key: document.getElementById('api-key').value.trim()
    };
    
    const hasChanged = JSON.stringify(current) !== JSON.stringify(state.originalSettings);
    document.getElementById('settings-warning').classList.toggle('hidden', !hasChanged);
}

// Initialize settings when page loads
document.addEventListener('DOMContentLoaded', () => {
    // Initialize core functionality
    loadConversations();
    updateSystemPrompt();
    startNewConversation();
    connectWebSocket();
    loadVersion();
    
    // Initialize settings only once
    initializeSettings();
    
    // Add event listeners
    document.getElementById('new-conversation-btn')?.addEventListener('click', startNewConversation);
    elements.chatMessages.addEventListener('scroll', handleScroll);
    handleScroll();
}, { once: true }); // Add {once: true} to ensure it only runs once

async function loadPrompts() {
    try {
        const response = await fetch('/prompts');
        if (!response.ok) throw new Error('Failed to fetch prompts');
        
        const data = await response.json();
        const promptSelector = document.getElementById('prompt-selector');
        promptSelector.innerHTML = '';
        
        // Sort prompts by name
        data.prompts.sort((a, b) => a.name.localeCompare(b.name));
        
        let activePrompt = null;
        let foundActive = false;
        
        // Add prompts to selector
        data.prompts.forEach(prompt => {
            const option = document.createElement('option');
            option.value = prompt.id;
            option.textContent = prompt.name;
            
            if (prompt.is_active) {
                option.selected = true;
                activePrompt = prompt;
                foundActive = true;
                // Set the collapsed summary text
                document.getElementById('collapsed-prompt-name').textContent = prompt.name;
            }
            
            promptSelector.appendChild(option);
        });

        // If we found an active prompt, set its content
        if (activePrompt) {
            elements.systemPrompt.value = activePrompt.content;
        } else if (data.prompts.length > 0 && !foundActive) {
            // If no prompt is marked as active, activate the first one
            const firstPrompt = data.prompts[0];
            await loadPromptContent(firstPrompt.id);
            promptSelector.value = firstPrompt.id;
        }

        // Show/hide collapsed summary based on saved state
        const isCollapsed = localStorage.getItem('systemPromptCollapsed') === 'true';
        document.getElementById('collapsed-prompt-summary').classList.toggle('hidden', !isCollapsed);
    } catch (error) {
        console.error('Error loading prompts:', error);
    }
}

// Update the handlePromptChange function to update is_active state
async function handlePromptChange(event) {
    const promptId = event.target.value;
    if (!promptId) return;
    
    try {
        // First activate the prompt
        const activateResponse = await fetch(`/prompts/${promptId}/activate`, {
            method: 'POST'
        });
        if (!activateResponse.ok) throw new Error('Failed to activate prompt');
        
        // Then load its content
        await loadPromptContent(promptId);
        
        // Update collapsed summary with selected prompt name
        const promptSelector = document.getElementById('prompt-selector');
        const selectedOption = promptSelector.options[promptSelector.selectedIndex];
        document.getElementById('collapsed-prompt-name').textContent = selectedOption.text;
        
    } catch (error) {
        console.error('Error changing prompt:', error);
        alert('Failed to change prompt');
        // Reload prompts to ensure correct state
        await loadPrompts();
    }
}

function openPromptModal(promptId = null) {
    state.editingPromptId = promptId;
    const modal = document.getElementById('prompt-modal');
    const title = document.getElementById('prompt-modal-title');
    const nameInput = document.getElementById('prompt-name');
    const textInput = document.getElementById('prompt-text');
    
    if (promptId) {
        title.textContent = 'Edit Prompt';
        // Load existing prompt data
        fetch(`/prompts/${promptId}`)
            .then(response => response.json())
            .then(data => {
                nameInput.value = data.name;
                textInput.value = data.content;
            });
    } else {
        title.textContent = 'Create New Prompt';
        nameInput.value = '';
        textInput.value = '';
    }
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closePromptModal() {
    const modal = document.getElementById('prompt-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    state.editingPromptId = null;
}

// Update form submit handler for the prompt modal
document.getElementById('prompt-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitButton = e.target.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    
    const name = document.getElementById('prompt-name').value.trim();
    const text = document.getElementById('prompt-text').value.trim();
    
    const promptData = {
        name: name,
        text: text
    };
    
    try {
        let response;
        if (state.editingPromptId) {
            response = await fetch(`/prompts/${state.editingPromptId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(promptData)
            });
        } else {
            response = await fetch('/prompts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(promptData)
            });
        }
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Failed to save prompt');
        }
        
        const result = await response.json();
        
        // Automatically activate the new/edited prompt
        await fetch(`/prompts/${result.id}/activate`, {
            method: 'POST'
        });
        
        closePromptModal();
        await loadPrompts(); // This will update dropdown and select the active prompt
        
        // Show success notification
        showNotification('Prompt saved successfully', 'success');
        
    } catch (error) {
        console.error('Error saving prompt:', error);
        // Show error notification instead of alert
        showNotification(error.message || 'Failed to save prompt', 'error');
    } finally {
        submitButton.disabled = false;
    }
});

// Add form submit handler for the prompt modal
document.getElementById('prompt-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('prompt-name').value.trim();
    const text = document.getElementById('prompt-text').value.trim();
    
    const promptData = {
        name: name,
        text: text
    };
    
    try {
        let response;
        if (state.editingPromptId) {
            response = await fetch(`/prompts/${state.editingPromptId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(promptData)
            });
        } else {
            response = await fetch('/prompts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(promptData)
            });
        }
        
        if (!response.ok) throw new Error('Failed to save prompt');
        
        const result = await response.json();
        
        // Automatically activate the new/edited prompt
        await fetch(`/prompts/${result.id}/activate`, {
            method: 'POST'
        });
        
        closePromptModal();
        await loadPrompts(); // This will update dropdown and select the active prompt
        
    } catch (error) {
        console.error('Error saving prompt:', error);
    }
});

// Update the DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', () => {
    // ...existing initialization code...
    
    // Add event listeners for prompts
    document.getElementById('prompt-selector')?.addEventListener('change', handlePromptChange);
    elements.systemPrompt?.addEventListener('input', handlePromptTextChange);
    document.getElementById('save-prompt-button')?.addEventListener('click', savePromptChanges);
    
    // Add handlers for prompt modal
    document.getElementById('prompt-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'prompt-modal') {
            closePromptModal();
        }
    });
    
    // Load prompts
    loadPrompts();
}, { once: true });

function handlePromptTextChange() {
    const promptText = elements.systemPrompt.value;
    const saveButton = document.getElementById('save-prompt-button');
    
    if (promptText !== state.originalPromptText) {
        saveButton.classList.remove('hidden');
        saveButton.classList.add('animate-pulse');  // Add pulse animation
        state.isPromptEdited = true;
    } else {
        saveButton.classList.add('hidden');
        saveButton.classList.remove('animate-pulse');
        state.isPromptEdited = false;
    }
}

async function savePromptChanges() {
    const saveButton = document.getElementById('save-prompt-button');
    saveButton.disabled = true;
    
    try {
        const promptSelector = document.getElementById('prompt-selector');
        const promptId = promptSelector.value;
        const promptText = elements.systemPrompt.value;
        const promptName = promptSelector.options[promptSelector.selectedIndex].text;
        
        const response = await fetch(`/prompts/${promptId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: promptName,
                text: promptText
            })
        });
        
        if (!response.ok) throw new Error('Failed to save prompt');
        
        state.originalPromptText = promptText;
        saveButton.classList.add('hidden');
        saveButton.classList.remove('animate-pulse');
        state.isPromptEdited = false;
        
        showNotification('Prompt saved successfully', 'success');
        
    } catch (error) {
        console.error('Error saving prompt:', error);
        showNotification('Failed to save prompt: ' + error.message, 'error');
    } finally {
        saveButton.disabled = false;
    }
}

// Add this new helper function for notifications
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 px-4 py-2 rounded-lg shadow-lg z-50 flex items-center gap-2 animate-fade-in ${
        type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
    }`;
    
    const icon = document.createElement('svg');
    icon.className = 'w-4 h-4';
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('viewBox', '0 0 24 24');
    
    if (type === 'success') {
        icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>';
    } else {
        icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>';
    }
    
    notification.appendChild(icon);
    notification.appendChild(document.createTextNode(message));
    
    document.body.appendChild(notification);
    
    // Add fade out animation
    setTimeout(() => {
        notification.classList.add('opacity-0', 'transform', 'translate-y-[-1rem]');
        notification.style.transition = 'all 0.5s ease-out';
    }, type === 'success' ? 1500 : 3000);
    
    // Remove the notification after animation
    setTimeout(() => {
        notification.remove();
    }, type === 'success' ? 2000 : 3500);
}

async function loadPromptContent(promptId) {
    try {
        const response = await fetch(`/prompts/${promptId}`);
        if (!response.ok) throw new Error('Failed to load prompt');
        
        const data = await response.json();
        const systemPrompt = elements.systemPrompt;
        systemPrompt.value = data.content;
        state.originalPromptText = data.content;
        document.getElementById('save-prompt-button').classList.add('hidden');
        state.isPromptEdited = false;
        
    } catch (error) {
        console.error('Error loading prompt:', error);
    }
}

function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    // Clear and focus the input
    const nameInput = document.getElementById('new-config-name');
    nameInput.value = '';
    nameInput.focus();
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

// Replace the old createNewSettingsConfig function with this one
async function createNewSettingsConfig() {
    openSettingsModal();
}

// Add new form submit handler for the settings modal
document.getElementById('new-settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('new-config-name').value.trim();
    const template = document.getElementById('settings-template').value;
    
    if (!name) {
        alert('Configuration name is required');
        return;
    }
    
    try {
        let defaultSettings;
        
        if (template === 'copy-current') {
            // Use current settings as template
            defaultSettings = {
                ...state.currentSettings,
                name: name,
                id: 'new'
            };
        } else {
            // Fetch default template
            const response = await fetch('/default_settings');
            if (!response.ok) throw new Error('Failed to fetch default values');
            defaultSettings = await response.json();
            defaultSettings.name = name;
            defaultSettings.id = 'new';
        }
        
        // Update form with new settings
        updateSettingsForm(defaultSettings);
        
        // Update stored settings state
        state.currentSettings = defaultSettings;
        state.originalSettings = null;
        
        // Show the unsaved changes warning
        document.getElementById('settings-warning').classList.remove('hidden');
        
        closeSettingsModal();
        
    } catch (error) {
        console.error('Failed to create new settings:', error);
        alert('Error creating new configuration');
    }
});

// Add click handler to close modal when clicking outside
document.getElementById('settings-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'settings-modal') {
        closeSettingsModal();
    }
});

// Update DOM Content Loaded event listener to include modal handlers
document.addEventListener('DOMContentLoaded', () => {
    // ...existing initialization code...
    
    // Add settings modal close on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSettingsModal();
        }
    });
    
}, { once: true });

function toggleSystemPrompt() {
    const container = document.getElementById('system-prompt-container');
    const chevron = document.getElementById('system-prompt-chevron');
    const collapsedSummary = document.getElementById('collapsed-prompt-summary');
    
    // Toggle the collapsed state with a smoother height transition
    if (!container.style.maxHeight || container.style.maxHeight === '0px') {
        container.style.maxHeight = container.scrollHeight + 'px';
        container.classList.remove('opacity-0');
        chevron.classList.add('rotate-180');
        collapsedSummary.classList.add('hidden');
    } else {
        container.style.maxHeight = '0px';
        container.classList.add('opacity-0');
        chevron.classList.remove('rotate-180');
        collapsedSummary.classList.remove('hidden');
    }
    
    // Save preference to localStorage
    localStorage.setItem('systemPromptCollapsed', container.style.maxHeight === '0px');
}
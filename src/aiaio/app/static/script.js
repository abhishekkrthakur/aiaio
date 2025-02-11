function formatTimestamp(timestamp) {
    const date = new Date(timestamp * 1000);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    const time = date.toLocaleTimeString();
    return `${month} ${day}, ${year} ${time}`;
}

let ws;

function connectWebSocket() {
    // Use secure WebSocket if the page is served over HTTPS
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };

    ws.onclose = () => {
        // Reconnect after a delay
        setTimeout(connectWebSocket, 3000);
    };

    // Send keepalive message every 30 seconds
    const keepAliveInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send('keepalive');
        }
    }, 30000);

    ws.onerror = (error) => {
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
            if (data.type === 'message_added' && currentConversationId === data.conversation_id) {
                loadConversation(data.conversation_id);
            } else if (data.type === 'conversation_deleted' && currentConversationId === data.conversation_id) {
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
    chatMessages.addEventListener('scroll', handleScroll);
    handleScroll(); // Check initial scroll position
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Optional: You could close the WebSocket here if desired
    } else {
        // Ensure we have a connection when page becomes visible
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            connectWebSocket();
        }
        loadConversations(); // One-time refresh when returning to the page
    }
});

let isLoading = false;
async function loadConversations() {
    if (isLoading) return;
    
    try {
        isLoading = true;
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
                        Messages: ${conv.message_count}
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
        isLoading = false;
    }
}

async function updateSystemPrompt() {
    try {
        const response = await fetch(`/get_system_prompt?conversation_id=${currentConversationId || ''}`);
        const data = await response.json();
        document.getElementById('system-prompt').value = data.system_prompt;
    } catch (error) {
        console.error('Error fetching system prompt:', error);
    }
}

async function loadConversation(conversationId) {
    try {
        currentConversationId = conversationId;
        const response = await fetch(`/conversations/${conversationId}`);
        const data = await response.json();
        // Clear current chat
        chatMessages.innerHTML = '';
        
        // Set current conversation ID
        currentConversationId = conversationId;
        
        // Display messages
        for (const msg of data.messages) {
            if (msg.role === 'user') {
                appendUserMessage(msg.content);
            } else if (msg.role === 'assistant') {
                currentAssistantMessage = createAssistantMessage();
                updateAssistantMessage(msg.content);
                currentAssistantMessage = null;
            }
        }

        // Fetch and update system prompt for the loaded conversation
        await updateSystemPrompt();
        
        // Reset scroll state
        isScrolledManually = false;
        
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
        currentConversationId = data.conversation_id;
        loadConversations();

        // Reset system prompt by fetching default from API
        await updateSystemPrompt();
    } catch (error) {
        console.error('Error creating conversation:', error);
    }
}

// Add function to start new conversation
async function startNewConversation() {
    chatMessages.innerHTML = '';
    currentConversationId = null;
    messageInput.value = '';
    document.getElementById('file-input').value = '';
    document.getElementById('file-preview-container').innerHTML = '';
    document.getElementById('file-preview-container').classList.add('hidden');
    await updateSystemPrompt(); // Fetch system prompt for new conversation
}

// Load conversations when page loads
document.addEventListener('DOMContentLoaded', () => {
    loadConversations();
    updateSystemPrompt(); // Replace loadSystemPrompt with updateSystemPrompt
    startNewConversation(); // Ensure we start with a new conversation
});

const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const chatMessages = document.getElementById('chat-messages');
let currentAssistantMessage = null;
let conversationHistory = [];
let isFirstMessage = true;
let uploadedFiles = [];
let currentConversationId = null; // This ensures we start with a new conversation

function appendUserMessage(content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-bubble user-message';
    messageDiv.textContent = content;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function createAssistantMessage() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-bubble assistant-message';
    chatMessages.appendChild(messageDiv);
    
    // Only scroll to bottom if we haven't manually scrolled up
    if (!isScrolledManually) {
        scrollToBottom();
    }
    return messageDiv;
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        const button = event.target;
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        setTimeout(() => {
            button.textContent = originalText;
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

function updateAssistantMessage(content) {
    if (!currentAssistantMessage) {
        currentAssistantMessage = createAssistantMessage();
    }

    const wasAtBottom = Math.abs(
        (chatMessages.scrollHeight - chatMessages.clientHeight) - chatMessages.scrollTop
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
    const existingHighlights = currentAssistantMessage.querySelectorAll('pre code');
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

    currentAssistantMessage.innerHTML = parsedContent;

    // Re-apply syntax highlighting to all code blocks
    currentAssistantMessage.querySelectorAll('pre code').forEach(block => {
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

    if (wasAtBottom && !isScrolledManually) {
        scrollToBottom();
    } else if (!wasAtBottom) {
        jumpToBottomButton.classList.add('visible');
    }
}

// Add this new event listener for Enter key
messageInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatForm.requestSubmit();
    }
});

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = messageInput.value.trim();
    const fileInput = document.getElementById('file-input');
    const files = fileInput.files;
    const sendButton = document.getElementById('send-button');
    
    if (!message && !files.length) return;

    messageInput.value = '';
    sendButton.disabled = true;
    
    try {
        if (!currentConversationId) {
            const createResponse = await fetch('/create_conversation', { method: 'POST' });
            const data = await createResponse.json();
            
            currentConversationId = data.conversation_id;
            loadConversations();
        }

        appendUserMessage(message);
        
        // Clear file previews
        document.getElementById('file-preview-container').innerHTML = '';
        document.getElementById('file-preview-container').classList.add('hidden');
        
        // Create FormData and append all data
        const formData = new FormData();
        formData.append('message', message);
        formData.append('system_prompt', document.getElementById('system-prompt').value.trim() || 'You are a helpful assistant');
        formData.append('conversation_id', currentConversationId);
        
        Array.from(files).forEach(file => {
            formData.append('files', file);
        });

        fileInput.value = '';

        // Create assistant message bubble immediately
        currentAssistantMessage = createAssistantMessage();
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
                    (chatMessages.scrollHeight - chatMessages.clientHeight) - chatMessages.scrollTop
                ) < 10;
                isScrolledManually = !isAtBottom;
                isFirstChunk = false;
            }
            
            // Update the message with the accumulated text
            updateAssistantMessage(responseText);
            
            // Only auto-scroll if user hasn't scrolled up
            if (!isScrolledManually) {
                scrollToBottom();
            }
        }

    } catch (error) {
        console.error('Error:', error);
        currentAssistantMessage = null;
        appendMessage('Sorry, something went wrong. ' + error.message, 'assistant');
    } finally {
        sendButton.disabled = false;
        
        // After streaming is complete, check if we should show jump-to-bottom button
        const isAtBottom = Math.abs(
            (chatMessages.scrollHeight - chatMessages.clientHeight) - chatMessages.scrollTop
        ) < 10;
        if (!isAtBottom) {
            jumpToBottomButton.classList.add('visible');
        }
    }
});

document.getElementById('file-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    const previewContainer = document.getElementById('file-preview-container');
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
            if (currentConversationId === conversationId) {
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

// Add these variables at the top of your script
let isScrolledManually = false;
let lastScrollTop = 0;
const jumpToBottomButton = document.getElementById('jump-to-bottom');

// Add this function to handle scrolling
function handleScroll() {
    const currentScrollTop = chatMessages.scrollTop;
    const maxScroll = chatMessages.scrollHeight - chatMessages.clientHeight;
    const isAtBottom = Math.abs(maxScroll - currentScrollTop) < 10;
    
    // Only set isScrolledManually if user is scrolling up
    if (currentScrollTop < lastScrollTop && !isAtBottom) {
        isScrolledManually = true;
    }
    
    // Show/hide jump to bottom button
    if (!isAtBottom) {
        jumpToBottomButton.classList.add('visible');
    } else {
        jumpToBottomButton.classList.remove('visible');
        isScrolledManually = false;
    }
    
    lastScrollTop = currentScrollTop;
}

// Add scroll event listener
chatMessages.addEventListener('scroll', handleScroll);

// Update scrollToBottom function
function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
    isScrolledManually = false;
    jumpToBottomButton.classList.remove('visible');
}

// Update your message handling functions to respect manual scrolling
function appendMessage(role, content) {
    // ...existing message appending code...
    
    // Only auto-scroll if user hasn't scrolled manually
    if (!isScrolledManually) {
        scrollToBottom();
    }
}

// Update your streaming response handler
async function handleStream(response) {
    // ...existing code...
    
    try {
        const reader = response.body.getReader();
        let partialMessage = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            // ...existing streaming code...
            
            // Only auto-scroll if user hasn't scrolled manually
            if (!isScrolledManually) {
                scrollToBottom();
            }
        }
    } catch (error) {
        console.error('Error reading stream:', error);
    }
}

let currentSettings = null;
let originalSettings = null;

// Initialize settings panel
async function initializeSettings() {
    try {
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
        const defaultSettings = await defaultResponse.json();
        
        // Create a Map to track unique settings by ID
        const uniqueSettings = new Map();
        
        // Add unique settings to the Map
        if (data.settings && data.settings.length > 0) {
            data.settings.forEach(setting => {
                // Only add if we haven't seen this ID before
                if (!uniqueSettings.has(setting.id)) {
                    uniqueSettings.set(setting.id, setting);
                }
            });
            
            // Convert Map values to array and sort if needed
            const sortedSettings = Array.from(uniqueSettings.values())
                .sort((a, b) => a.name.localeCompare(b.name));
            
            // Populate selector with unique settings
            sortedSettings.forEach(setting => {
                const option = document.createElement('option');
                option.value = setting.id;
                option.textContent = setting.name;
                option.selected = setting.id === defaultSettings.id;
                selector.appendChild(option);
            });
            
            // Load selected settings if any options were added
            if (selector.options.length > 0) {
                await loadSettingsConfig(selector.value);
            }
        }
        
        // Add change listener
        selector.addEventListener('change', (e) => loadSettingsConfig(e.target.value));
        
        // Add input listeners for change detection
        addSettingsChangeListeners();
        
    } catch (error) {
        console.error('Failed to initialize settings:', error);
        alert('Error loading settings configurations');
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
        currentSettings = settings;
        originalSettings = {...settings};
        
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
    try {
        // Get default values
        const response = await fetch('/default_settings');
        if (!response.ok) throw new Error('Failed to fetch default values');
        
        const defaults = await response.json();
        
        // Get name from user
        const name = prompt('Enter name for new configuration:');
        if (!name?.trim()) {
            alert('Configuration name is required');
            return;
        }
        
        // Update form with default values and new name without saving
        updateSettingsForm({
            ...defaults,
            name: name.trim(),
            id: 'new' // Special marker for new unsaved config
        });
        
        // Update stored settings state
        currentSettings = {
            ...defaults,
            name: name.trim(),
            id: 'new'
        };
        originalSettings = null; // This will make the form show as "unsaved"
        
        // Show the unsaved changes warning
        document.getElementById('settings-warning').classList.remove('hidden');
        
    } catch (error) {
        console.error('Failed to load default settings:', error);
        alert('Error creating new configuration');
    }
}

// Update saveSettings function to remove default toggle handling
async function saveSettings() {
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
        if (currentSettings.id === 'new') {
            response = await fetch('/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
        } else {
            // Update existing configuration
            settings.id = currentSettings.id;
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
        const settingsId = currentSettings.id === 'new' ? result.id : settings.id;
        
        // Set as default automatically
        const defaultResponse = await fetch(`/settings/${settingsId}/set_default`, {
            method: 'POST'
        });
        
        if (!defaultResponse.ok) {
            throw new Error('Failed to set as default');
        }

        // Update the current settings state
        currentSettings = {
            ...settings,
            id: settingsId
        };
        originalSettings = {...currentSettings};
        
        // Hide the warning since we just saved
        document.getElementById('settings-warning').classList.add('hidden');
        
        // Refresh the settings list and reselect current settings
        await initializeSettings();
        document.getElementById('settings-selector').value = settingsId;
        
        alert('Settings saved successfully');
        
    } catch (error) {
        console.error('Failed to save settings:', error);
        alert('Error saving settings: ' + error.message);
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
    if (!originalSettings) return;
    
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
    
    const hasChanged = JSON.stringify(current) !== JSON.stringify(originalSettings);
    document.getElementById('settings-warning').classList.toggle('hidden', !hasChanged);
}

// Initialize settings when page loads
document.addEventListener('DOMContentLoaded', () => {
    // ...existing code...
    initializeSettings();
    // ...existing code...
});
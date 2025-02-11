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
                const summaryElement = conversationElement.querySelector('.text-\\[10px\\].text-gray-500');
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
    loadSettings(); // Add this line
    loadVersion(); // Add this line
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

// Add new conversation button event listener
document.getElementById('new-conversation-btn')?.addEventListener('click', startNewConversation);

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

let originalSettings = {};

async function loadSettings() {
    try {
        const response = await fetch('/settings');
        const settings = await response.json();
        
        // Store original settings
        originalSettings = {...settings};
        
        // Update input values with server settings
        updateSettingsInputs(settings);
    } catch (error) {
        console.error('Error loading settings:', error);
        resetSettings();
    }
}

function updateSettingsInputs(settings) {
    document.getElementById('temperature').value = settings.temperature || 1.0;
    document.getElementById('temperature-value').textContent = settings.temperature || 1.0;
    document.getElementById('top_p').value = settings.top_p || 0.95;
    document.getElementById('top_p-value').textContent = settings.top_p || 0.95;
    document.getElementById('max_tokens').value = settings.max_tokens || 4096;
    document.getElementById('host').value = settings.host || 'http://localhost:8000/v1';
    document.getElementById('model_name').value = settings.model_name || 'meta-llama/Llama-3.2-1B-Instruct';
    document.getElementById('api_key').value = settings.api_key || '';
}

function getCurrentSettings() {
    return {
        temperature: parseFloat(document.getElementById('temperature').value),
        top_p: parseFloat(document.getElementById('top_p').value),
        max_tokens: parseInt(document.getElementById('max_tokens').value),
        host: document.getElementById('host').value,
        model_name: document.getElementById('model_name').value,
        api_key: document.getElementById('api_key').value
    };
}

async function checkSettingsChanged() {
    const currentSettings = getCurrentSettings();
    const warning = document.getElementById('settings-warning');
    
    try {
        const response = await fetch('/settings');
        const serverSettings = await response.json();
        
        const hasChanges = Object.keys(currentSettings).some(key => 
            serverSettings[key] !== currentSettings[key]
        );
        
        warning.classList.toggle('hidden', !hasChanges);
    } catch (error) {
        console.error('Error checking settings:', error);
        // If we can't reach the server, hide the warning
        warning.classList.add('hidden');
    }
}

// Add change listeners to all settings inputs
['temperature', 'top_p', 'max_tokens', 'host', 'model_name', 'api_key'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        // Debounce the check to avoid too many server requests
        clearTimeout(window.settingsCheckTimeout);
        window.settingsCheckTimeout = setTimeout(checkSettingsChanged, 300);
    });
});

async function saveSettings() {
    try {
        const response = await fetch('/save_settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(getCurrentSettings())
        });

        if (response.ok) {
            // Update original settings to match current
            originalSettings = getCurrentSettings();
            // Hide warning
            document.getElementById('settings-warning').classList.add('hidden');
            alert('Settings saved successfully');
        } else {
            alert('Failed to save settings');
        }
    } catch (error) {
        console.error('Error saving settings:', error);
        alert('Error saving settings');
    }
}

async function performSettingsReset() {
    try {
        const response = await fetch('/settings/defaults');
        const defaultSettings = await response.json();
        updateSettingsInputs(defaultSettings);
        originalSettings = {...defaultSettings};
        document.getElementById('settings-warning').classList.add('hidden');
    } catch (error) {
        console.error('Error fetching default settings:', error);
        const fallbackDefaults = {
            temperature: 1.0,
            top_p: 0.95,
            max_tokens: 4096,
            host: 'http://localhost:8000/v1',
            model_name: 'meta-llama/Llama-3.2-1B-Instruct',
            api_key: ''
        };
        updateSettingsInputs(fallbackDefaults);
        originalSettings = {...fallbackDefaults};
        document.getElementById('settings-warning').classList.add('hidden');
    }
}

function injectSettingsModal() {
    // Create modal if it doesn't exist
    if (!document.getElementById('settings-modal')) {
        const modal = document.createElement('div');
        modal.id = 'settings-modal';
        modal.className = 'fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center hidden';
        modal.innerHTML = `
            <div class="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm mx-auto">
                <h3 class="text-lg font-semibold mb-4">Confirm Reset</h3>
                <p class="mb-4">Are you sure you want to reset all settings to factory defaults? This cannot be undone.</p>
                <div class="flex justify-end gap-2">
                    <button id="cancel-reset" class="px-4 py-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 rounded">
                        Cancel
                    </button>
                    <button id="confirm-reset" class="px-4 py-2 bg-red-500 text-white hover:bg-red-600 rounded">
                        Reset Settings
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Add event listeners
        document.getElementById('cancel-reset').addEventListener('click', () => {
            modal.classList.add('hidden');
        });

        document.getElementById('confirm-reset').addEventListener('click', async () => {
            modal.classList.add('hidden');
            await performSettingsReset();
        });

        // Close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    }
}

function resetSettings() {
    injectSettingsModal();
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('hidden');
}

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

// Add this initialization when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // ...existing initialization code...
    
    // Initialize scroll handling
    chatMessages.addEventListener('scroll', handleScroll);
    handleScroll(); // Check initial scroll position
});
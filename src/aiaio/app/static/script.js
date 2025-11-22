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
    isPromptEdited: false,
    editingMessageId: null,
    editingMessageId: null,
    abortController: null,
    clientId: crypto.randomUUID(),
    selectedFiles: [] // Track selected files
};

// DOM Elements
const elements = {
    chatForm: document.getElementById('chat-form'),
    messageInput: document.getElementById('message-input'),
    chatMessages: document.getElementById('chat-messages'),
    messagesContainer: document.getElementById('messages-container'),
    jumpToBottomButton: document.getElementById('jump-to-bottom'),
    systemPrompt: document.getElementById('system-prompt'),
    fileInput: document.getElementById('file-input'),
    filePreviewContainer: document.getElementById('file-preview-container'),
    sendButton: document.getElementById('send-button'),
    stopButton: document.getElementById('stop-button'),
    sidebar: document.getElementById('sidebar'),
    settingsSidebar: document.getElementById('settings-sidebar'),
    sidebarOverlay: document.getElementById('sidebar-overlay'),
    systemPromptPanel: document.getElementById('system-prompt-panel'),
    systemPromptContent: document.getElementById('system-prompt-content'),
    systemPromptChevron: document.getElementById('system-prompt-chevron'),
    promptSelector: document.getElementById('prompt-selector'),
    savePromptButton: document.getElementById('save-prompt-button'),
    settingsSelector: document.getElementById('settings-selector'),
    saveSettingsButton: document.getElementById('save-settings'),
    setDefaultSettingsButton: document.getElementById('set-default-settings')
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeCore();
    initializeEventListeners();

    // Check initial theme
    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
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
    elements.promptSelector?.addEventListener('change', handlePromptChange);
    elements.systemPrompt.addEventListener('input', handlePromptTextChange);
    elements.savePromptButton.addEventListener('click', savePromptChanges);

    // Settings listeners
    elements.settingsSelector?.addEventListener('change', handleSettingsChange);
    elements.saveSettingsButton?.addEventListener('click', saveSettings);
    elements.setDefaultSettingsButton?.addEventListener('click', setDefaultSettings);

    // Slider listeners
    document.getElementById('temperature')?.addEventListener('input', (e) => {
        document.getElementById('temp-value').textContent = e.target.value;
    });
    document.getElementById('top-p')?.addEventListener('input', (e) => {
        document.getElementById('top-p-value').textContent = e.target.value;
    });

    // Handle visibility change
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Auto-resize textarea
    elements.messageInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if (this.value === '') this.style.height = 'auto';
    });
}

// UI Toggle Functions
function openSidebar() {
    elements.sidebar.classList.remove('-translate-x-full');
    elements.sidebarOverlay.classList.remove('hidden');
}

function closeSidebar() {
    elements.sidebar.classList.add('-translate-x-full');
    elements.sidebarOverlay.classList.add('hidden');
}

function toggleSettings() {
    const isHidden = elements.settingsSidebar.classList.contains('translate-x-full');
    const overlay = document.getElementById('settings-overlay');

    if (isHidden) {
        elements.settingsSidebar.classList.remove('translate-x-full');
        overlay.classList.remove('hidden');
        // Small delay to allow display:block to apply before opacity transition
        setTimeout(() => overlay.classList.remove('opacity-0'), 10);
    } else {
        elements.settingsSidebar.classList.add('translate-x-full');
        overlay.classList.add('opacity-0');
        setTimeout(() => overlay.classList.add('hidden'), 300);
    }
}

// Modal Logic
function showModal(title, message, type = 'info', onConfirm = null) {
    const modal = document.getElementById('custom-modal');
    const content = document.getElementById('modal-content');
    const titleEl = document.getElementById('modal-title');
    const messageEl = document.getElementById('modal-message');
    const actionsEl = document.getElementById('modal-actions');

    titleEl.textContent = title;
    messageEl.textContent = message;
    actionsEl.innerHTML = '';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-sm font-medium';
    closeBtn.textContent = type === 'confirm' ? 'Cancel' : 'Close';
    closeBtn.onclick = closeModal;
    actionsEl.appendChild(closeBtn);

    if (type === 'confirm' && onConfirm) {
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium shadow-lg shadow-blue-600/20';
        confirmBtn.textContent = 'Confirm';
        confirmBtn.onclick = () => {
            onConfirm();
            closeModal();
        };
        actionsEl.appendChild(confirmBtn);
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);
}

function closeModal() {
    const modal = document.getElementById('custom-modal');
    const content = document.getElementById('modal-content');

    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');

    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 200);
}

function toggleSystemPrompt() {
    const isHidden = elements.systemPromptContent.classList.contains('hidden');
    if (isHidden) {
        elements.systemPromptContent.classList.remove('hidden');
        elements.systemPromptChevron.classList.add('rotate-180');
    } else {
        elements.systemPromptContent.classList.add('hidden');
        elements.systemPromptChevron.classList.remove('rotate-180');
    }
}

function toggleDarkMode() {
    if (document.documentElement.classList.contains('dark')) {
        document.documentElement.classList.remove('dark');
        localStorage.theme = 'light';
    } else {
        document.documentElement.classList.add('dark');
        localStorage.theme = 'dark';
    }
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp * 1000);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} ${date.toLocaleTimeString()}`;
}

function scrollToBottom() {
    elements.chatMessages.scrollTo({
        top: elements.chatMessages.scrollHeight,
        behavior: 'smooth'
    });
    state.isScrolledManually = false;
    elements.jumpToBottomButton.classList.remove('opacity-100', 'translate-y-0');
    elements.jumpToBottomButton.classList.add('opacity-0', 'translate-y-4');
}

function handleScroll() {
    const { scrollTop, scrollHeight, clientHeight } = elements.chatMessages;
    const isAtBottom = Math.abs((scrollHeight - clientHeight) - scrollTop) < 50;

    if (!isAtBottom) {
        state.isScrolledManually = true;
        elements.jumpToBottomButton.classList.remove('opacity-0', 'translate-y-4');
        elements.jumpToBottomButton.classList.add('opacity-100', 'translate-y-0');
    } else {
        state.isScrolledManually = false;
        elements.jumpToBottomButton.classList.remove('opacity-100', 'translate-y-0');
        elements.jumpToBottomButton.classList.add('opacity-0', 'translate-y-4');
    }
}

function copyToClipboard(text, button) {
    navigator.clipboard.writeText(text)
        .then(() => {
            const originalIcon = button.innerHTML;
            button.innerHTML = '<i class="fa-solid fa-check text-green-500"></i>';
            setTimeout(() => {
                button.innerHTML = originalIcon;
            }, 2000);
        })
        .catch(err => console.error('Failed to copy:', err));
}

// WebSocket and API Logic
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${state.clientId}`;

    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => console.log('WebSocket connected');
    state.ws.onmessage = (event) => handleWebSocketMessage(JSON.parse(event.data));
    state.ws.onclose = () => setTimeout(connectWebSocket, 3000);
    state.ws.onerror = (error) => console.error('WebSocket error:', error);
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'conversation_created':
        case 'conversation_deleted':
        case 'message_added':
            loadConversations();
            if (data.type === 'message_added' && state.currentConversationId === data.conversation_id) {
                // Update the last message ID if it's missing (from streaming)
                const lastMessage = elements.messagesContainer.lastElementChild;
                if (lastMessage && !lastMessage.dataset.messageId && data.message_id) {
                    lastMessage.dataset.messageId = data.message_id;

                    // Update regenerate button
                    const regenerateBtn = lastMessage.querySelector('.regenerate-button');
                    if (regenerateBtn) {
                        regenerateBtn.onclick = () => regenerateResponse(lastMessage, data.message_id);
                    }

                    // Update edit button
                    const editBtn = lastMessage.querySelector('.edit-button');
                    if (editBtn) {
                        editBtn.onclick = () => openEditModal(lastMessage, data.message_id, lastMessage.querySelector('.prose').innerHTML);
                    }
                }
            } else if (data.type === 'conversation_deleted' && state.currentConversationId === data.conversation_id) {
                startNewConversation();
            }
            break;

        case 'message_edited':
            const messageDiv = document.querySelector(`[data-message-id="${data.message_id}"]`);
            if (messageDiv) {
                if (data.role === 'assistant') {
                    updateAssistantMessage(data.content, messageDiv);
                } else {
                    // Update user message content
                    const contentDiv = messageDiv.querySelector('.prose');
                    if (contentDiv) contentDiv.textContent = data.content;

                    // Update edit button onclick
                    const editBtn = messageDiv.querySelector('button[onclick^="openEditModal"]');
                    if (editBtn) {
                        editBtn.onclick = () => openEditModal(messageDiv, data.message_id, data.content);
                    }
                }
            }
            break;

        case 'summary_updated':
            const conversationElement = document.querySelector(`[data-conversation-id="${data.conversation_id}"]`);
            if (conversationElement) {
                const summaryElement = conversationElement.querySelector('.summary-text');
                if (summaryElement) {
                    summaryElement.textContent = data.summary || 'No summary';
                }
            }
            break;
    }
}

async function loadConversations() {
    if (state.isLoading) return;

    try {
        state.isLoading = true;
        const response = await fetch('/conversations');
        const data = await response.json();
        const conversationsList = document.getElementById('conversations-list');

        data.conversations.sort((a, b) => b.last_updated - a.last_updated);

        const newConvs = data.conversations.map(conv => {
            const lastUpdated = formatTimestamp(conv.last_updated);
            const isActive = conv.conversation_id === state.currentConversationId;
            const activeClass = isActive ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 border-transparent';

            return `
                <div class="group w-full p-3 rounded-xl border transition-all duration-200 cursor-pointer mb-2 relative ${activeClass}" 
                     onclick="loadConversation('${conv.conversation_id}')"
                     data-conversation-id="${conv.conversation_id}">
                    <div class="flex flex-col gap-1">
                        <div class="flex items-center justify-between">
                            <div class="text-sm font-medium text-gray-700 dark:text-gray-200 truncate flex-1 summary-text">
                                ${conv.summary || 'New Conversation'}
                            </div>
                            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                <button onclick="deleteConversation('${conv.conversation_id}', event)"
                                        class="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                                    <i class="fa-solid fa-trash text-xs"></i>
                                </button>
                            </div>
                        </div>
                        <div class="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
                            ${lastUpdated}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        if (conversationsList.innerHTML !== newConvs) {
            conversationsList.innerHTML = newConvs;
        }
    } catch (error) {
        console.error('Error loading conversations:', error);
    } finally {
        state.isLoading = false;
    }
}

async function deleteConversation(conversationId, event) {
    event.stopPropagation();

    showModal('Delete Conversation', 'Are you sure you want to delete this conversation? This action cannot be undone.', 'confirm', async () => {
        try {
            await fetch(`/conversations/${conversationId}`, { method: 'DELETE' });
            // WebSocket will handle the UI update
        } catch (error) {
            console.error('Error deleting conversation:', error);
            showModal('Error', 'Failed to delete conversation', 'error');
        }
    });
}

async function loadConversation(conversationId) {
    try {
        state.currentConversationId = conversationId;
        const response = await fetch(`/conversations/${conversationId}`);
        const data = await response.json();

        elements.messagesContainer.innerHTML = '';

        for (const msg of data.messages) {
            if (msg.role === 'user') {
                appendUserMessage(msg.content, msg.message_id, msg.attachments);
            } else if (msg.role === 'assistant') {
                const msgDiv = createAssistantMessage(msg.message_id, msg.content);
                updateAssistantMessage(msg.content, msgDiv);
            }
        }

        await updateSystemPrompt();
        loadConversations(); // Update active state in list

        state.isScrolledManually = false;
        setTimeout(scrollToBottom, 100);

        // Close sidebar on mobile when selecting a conversation
        if (window.innerWidth < 640) {
            closeSidebar();
        }
    } catch (error) {
        console.error('Error loading conversation:', error);
    }
}

async function startNewConversation() {
    elements.messagesContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full text-center text-gray-400 mt-20 opacity-50">
            <div class="w-16 h-16 bg-gray-200 dark:bg-gray-800 rounded-2xl flex items-center justify-center mb-4">
                <i class="fa-solid fa-comments text-2xl"></i>
            </div>
            <p class="text-sm">Start a new conversation</p>
        </div>
    `;
    state.currentConversationId = null;
    elements.messageInput.value = '';
    elements.messageInput.style.height = 'auto';
    elements.fileInput.value = '';
    elements.filePreviewContainer.innerHTML = '';
    elements.filePreviewContainer.classList.add('hidden');
    await updateSystemPrompt();
    loadConversations(); // Update active state

    if (window.innerWidth < 640) {
        closeSidebar();
    }
}

function appendUserMessage(content, messageId, attachments = []) {
    // Remove empty state if present
    if (elements.messagesContainer.querySelector('.text-center.opacity-50')) {
        elements.messagesContainer.innerHTML = '';
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = 'flex justify-end message-bubble group animate-fade-in';
    if (messageId) messageDiv.dataset.messageId = messageId;

    let attachmentsHtml = '';
    if (attachments && attachments.length > 0) {
        attachmentsHtml = '<div class="flex flex-wrap gap-2 mb-2 justify-end">';
        attachments.forEach(att => {
            const isImage = att.type?.startsWith('image/') || att.file_type?.startsWith('image/');
            // Handle both File objects (upload) and DB objects (history)
            const name = att.name || att.file_name;

            if (isImage) {
                let src = '';
                if (att instanceof File) {
                    src = URL.createObjectURL(att);
                } else {
                    // For history items, we need an endpoint or base64. 
                    // Since we don't have an endpoint yet, we'll use a placeholder or check if we can get base64.
                    // Ideally, we should add an endpoint /attachments/{id}
                    // For now, let's show the icon for history to avoid broken images, 
                    // unless we have the data url (which we don't store in history currently).
                    // UPDATE: We will implement the endpoint next. For now, assume it exists or fallback.
                    src = `/attachments/${att.attachment_id}`;
                }

                attachmentsHtml += `
                    <div class="group/image relative">
                        <img src="${src}" alt="${name}" class="h-20 w-auto rounded-lg border border-blue-500/30 object-cover cursor-pointer hover:opacity-90 transition-opacity" onclick="window.open(this.src, '_blank')">
                        <div class="absolute inset-0 bg-black/0 group-hover/image:bg-black/10 transition-colors rounded-lg"></div>
                    </div>
                `;
            } else {
                attachmentsHtml += `
                    <div class="flex items-center gap-2 bg-blue-700/50 rounded-lg px-3 py-2 text-xs text-blue-100 border border-blue-500/30">
                        <i class="fa-solid fa-file"></i>
                        <span class="max-w-[150px] truncate">${name}</span>
                    </div>
                `;
            }
        });
        attachmentsHtml += '</div>';
    }

    messageDiv.innerHTML = `
        <div class="max-w-[85%] sm:max-w-[75%] bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 shadow-md relative mb-2">
            ${attachmentsHtml}
            <div class="prose prose-invert max-w-none text-sm sm:text-base leading-relaxed break-words">
                ${content}
            </div>
            <button onclick="openEditModal(this.closest('.message-bubble'), '${messageId || ''}', \`${content.replace(/`/g, '\\`').replace(/"/g, '&quot;')}\`)" 
                    class="absolute top-2 right-2 p-1 text-blue-200 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity">
                <i class="fa-solid fa-pen text-xs"></i>
            </button>
        </div>
    `;

    elements.messagesContainer.appendChild(messageDiv);
    scrollToBottom();
}

function createAssistantMessage(messageId, content = '') {
    // Remove empty state if present
    if (elements.messagesContainer.querySelector('.text-center.opacity-50')) {
        elements.messagesContainer.innerHTML = '';
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = 'flex justify-start message-bubble group w-full animate-fade-in';
    if (messageId) messageDiv.dataset.messageId = messageId;

    messageDiv.innerHTML = `
        <div class="flex gap-3 max-w-full w-full">
            <div class="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-md mt-1">
                <i class="fa-solid fa-robot text-white text-xs"></i>
            </div>
            <div class="flex-1 min-w-0">
                <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl rounded-tl-sm px-5 py-4 shadow-sm relative mb-2">
                    <div class="message-content prose prose-slate dark:prose-invert max-w-none text-sm sm:text-base leading-relaxed break-words">
                        ${content}
                    </div>
                    <div class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-gray-800 rounded-lg p-1 shadow-sm border border-gray-100 dark:border-gray-700">
                        <button class="regenerate-button p-1.5 text-gray-400 hover:text-blue-500 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title="Regenerate">
                            <i class="fa-solid fa-rotate-right text-xs"></i>
                        </button>
                        <button class="edit-button p-1.5 text-gray-400 hover:text-blue-500 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title="Edit">
                            <i class="fa-solid fa-pen text-xs"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Bind events
    const regenerateBtn = messageDiv.querySelector('.regenerate-button');
    regenerateBtn.onclick = () => regenerateResponse(messageDiv, messageId);

    const editBtn = messageDiv.querySelector('.edit-button');
    editBtn.onclick = () => openEditModal(messageDiv, messageId, content);

    elements.messagesContainer.appendChild(messageDiv);
    return messageDiv;
}

function updateAssistantMessage(content, messageDiv = null) {
    if (!messageDiv) {
        if (!state.currentAssistantMessage) {
            state.currentAssistantMessage = createAssistantMessage(null, '');
        }
        messageDiv = state.currentAssistantMessage;
    }

    const contentDiv = messageDiv.querySelector('.message-content');

    // Configure marked
    marked.setOptions({
        gfm: true,
        breaks: true,
        highlight: function (code, language) {
            if (language && hljs.getLanguage(language)) {
                try {
                    return hljs.highlight(code, { language }).value;
                } catch (err) { }
            }
            return code;
        }
    });

    // Parse content
    let parsedContent = marked.parse(content);

    // Update content
    contentDiv.innerHTML = parsedContent;

    // Check if user is near bottom before scrolling
    const container = document.getElementById('chat-messages');
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;

    if (isNearBottom || !state.isScrolledManually) {
        scrollToBottom();
    }

    // Apply syntax highlighting and copy buttons
    contentDiv.querySelectorAll('pre code').forEach(block => {
        hljs.highlightElement(block);

        const pre = block.parentNode;
        if (!pre.querySelector('.copy-button')) {
            const copyButton = document.createElement('button');
            copyButton.className = 'copy-button absolute top-2 right-2 p-1.5 text-gray-400 hover:text-white bg-gray-800/50 hover:bg-gray-700 rounded-md transition-colors opacity-0 group-hover:opacity-100';
            copyButton.innerHTML = '<i class="fa-regular fa-copy"></i>';
            copyButton.onclick = (e) => {
                e.preventDefault();
                copyToClipboard(block.textContent, copyButton);
            };
            pre.style.position = 'relative';
            pre.classList.add('group');
            pre.appendChild(copyButton);
        }
    });

    // Update edit button content reference
    const editBtn = messageDiv.querySelector('.edit-button');
    if (editBtn) {
        editBtn.onclick = () => openEditModal(messageDiv, messageDiv.dataset.messageId, content);
    }

    if (!state.isScrolledManually) {
        scrollToBottom();
    }
}

// Message Editing
function openEditModal(messageDiv, messageId, content) {
    const modal = document.getElementById('message-edit-modal');
    const contentInput = document.getElementById('edit-message-content');
    const messageIdInput = document.getElementById('edit-message-id');

    state.editingMessageDiv = messageDiv;
    state.editingMessageId = messageId;

    contentInput.value = content;
    messageIdInput.value = messageId;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    contentInput.focus();
}

function closeEditModal() {
    const modal = document.getElementById('message-edit-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    state.editingMessageDiv = null;
    state.editingMessageId = null;
}

document.getElementById('message-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = document.getElementById('edit-message-content').value.trim();
    const messageId = document.getElementById('edit-message-id').value;

    if (!content || !state.editingMessageId) return;

    try {
        const response = await fetch(`/messages/${state.editingMessageId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });

        if (!response.ok) throw new Error('Failed to save message');

        closeEditModal();
        // UI update handled by WebSocket
    } catch (error) {
        console.error('Error updating message:', error);
        showModal('Error', 'Failed to update message', 'error');
    }
});

// Chat Submission
elements.chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = elements.messageInput.value.trim();
    const files = state.selectedFiles;

    if (!message && !files.length) return;

    state.abortController = new AbortController();

    elements.messageInput.value = '';
    elements.messageInput.style.height = 'auto';
    elements.sendButton.disabled = true;
    elements.sendButton.classList.add('hidden');
    elements.stopButton.classList.remove('hidden');

    try {
        if (!state.currentConversationId) {
            const createResponse = await fetch('/create_conversation', { method: 'POST' });
            const data = await createResponse.json();
            state.currentConversationId = data.conversation_id;
            loadConversations();
        }

        appendUserMessage(message, null, files);

        elements.filePreviewContainer.innerHTML = '';
        elements.filePreviewContainer.classList.add('hidden');
        state.selectedFiles = []; // Clear selected files

        const formData = new FormData();
        formData.append('message', message);
        formData.append('system_prompt', elements.systemPrompt.value.trim() || 'You are a helpful assistant');
        formData.append('conversation_id', state.currentConversationId);
        formData.append('client_id', state.clientId);

        Array.from(files).forEach(file => formData.append('files', file));

        elements.fileInput.value = '';

        state.currentAssistantMessage = createAssistantMessage();
        let responseText = '';

        const response = await fetch('/chat', {
            method: 'POST',
            body: formData,
            signal: state.abortController.signal
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            responseText += chunk;
            updateAssistantMessage(responseText);
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Error:', error);
            state.currentAssistantMessage = null;
            // Use modal for error instead of appending message
            showModal('Error', 'Something went wrong: ' + error.message, 'error');
        }
    } finally {
        elements.sendButton.disabled = false;
        elements.sendButton.classList.remove('hidden');
        elements.stopButton.classList.add('hidden');
        state.abortController = null;
        state.currentAssistantMessage = null;
    }
});

elements.messageInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        elements.chatForm.requestSubmit();
    }
});

elements.stopButton.addEventListener('click', () => {
    if (state.abortController) state.abortController.abort();
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type: 'stop_generation' })); // Assuming backend handles this
    }
});

// File Input
elements.fileInput.addEventListener('change', (e) => {
    const newFiles = Array.from(e.target.files);
    state.selectedFiles = [...state.selectedFiles, ...newFiles];
    updateFilePreviews();
    elements.fileInput.value = ''; // Reset input to allow selecting same file again
});

function updateFilePreviews() {
    const previewContainer = elements.filePreviewContainer;
    previewContainer.innerHTML = '';

    if (state.selectedFiles.length > 0) {
        previewContainer.classList.remove('hidden');

        state.selectedFiles.forEach((file, index) => {
            const previewDiv = document.createElement('div');
            previewDiv.className = 'flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2 flex-shrink-0 border border-gray-200 dark:border-gray-700';

            let contentHtml = '';
            if (file.type.startsWith('image/')) {
                const url = URL.createObjectURL(file);
                contentHtml = `<img src="${url}" class="w-8 h-8 object-cover rounded border border-gray-300 dark:border-gray-600">`;
            } else {
                let iconClass = 'fa-file';
                if (file.type.startsWith('text/')) iconClass = 'fa-file-code';
                contentHtml = `<i class="fa-solid ${iconClass} text-gray-500 text-lg"></i>`;
            }

            previewDiv.innerHTML = `
                ${contentHtml}
                <span class="text-xs text-gray-700 dark:text-gray-300 max-w-[150px] truncate">${file.name}</span>
                <button type="button" class="text-gray-400 hover:text-red-500 transition-colors ml-1" onclick="removeFile(${index})">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            `;
            previewContainer.appendChild(previewDiv);
        });
    } else {
        previewContainer.classList.add('hidden');
    }
}

function removeFile(index) {
    state.selectedFiles.splice(index, 1);
    updateFilePreviews();
}

// Settings and Prompts
async function updateSystemPrompt() {
    try {
        const response = await fetch(`/get_system_prompt?conversation_id=${state.currentConversationId || ''}`);
        const data = await response.json();
        elements.systemPrompt.value = data.system_prompt;
    } catch (error) {
        console.error('Error fetching system prompt:', error);
    }
}

async function loadPrompts() {
    try {
        const response = await fetch('/prompts');
        const data = await response.json();

        elements.promptSelector.innerHTML = '<option value="">Select a prompt...</option>';
        data.prompts.forEach(prompt => {
            const option = document.createElement('option');
            option.value = prompt.id;
            option.textContent = prompt.name;
            if (prompt.is_active) option.selected = true;
            elements.promptSelector.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading prompts:', error);
    }
}

async function handlePromptChange(e) {
    const promptId = e.target.value;
    if (!promptId) return;

    try {
        // Activate prompt
        await fetch(`/prompts/${promptId}/activate`, { method: 'POST' });

        // Get prompt content
        const response = await fetch(`/prompts/${promptId}`);
        const data = await response.json();
        elements.systemPrompt.value = data.content;
    } catch (error) {
        console.error('Error changing prompt:', error);
    }
}

function handlePromptTextChange() {
    // Enable save button if needed, or just auto-save logic
    // For now, we'll just let the user click save
}

async function savePromptChanges() {
    const text = elements.systemPrompt.value;
    // Use prompt() for now as it's input, but could be replaced with a custom input modal later
    const name = prompt('Enter a name for this prompt:', 'New Prompt');
    if (!name) return;

    try {
        await fetch('/prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, text })
        });
        loadPrompts();
        showModal('Success', 'System prompt saved successfully!', 'info');
    } catch (error) {
        console.error('Error saving prompt:', error);
        showModal('Error', 'Failed to save prompt', 'error');
    }
}

function handleVisibilityChange() {
    if (!document.hidden) {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
            connectWebSocket();
        }
        loadConversations();
    }
}

async function initializeSettings() {
    try {
        // Load all settings configs
        const response = await fetch('/settings/all');
        const data = await response.json();

        elements.settingsSelector.innerHTML = '';
        data.settings.forEach(setting => {
            const option = document.createElement('option');
            option.value = setting.id;
            option.textContent = setting.name;
            if (setting.default) option.selected = true;
            elements.settingsSelector.appendChild(option);
        });

        // Load current settings
        const currentResponse = await fetch('/settings');
        const currentSettings = await currentResponse.json();
        populateSettingsForm(currentSettings);

    } catch (error) {
        console.error('Error initializing settings:', error);
    }
}

function populateSettingsForm(settings) {
    document.getElementById('api-host').value = settings.host;
    document.getElementById('api-key').value = settings.api_key;
    document.getElementById('model-name').value = settings.model_name;
    document.getElementById('temperature').value = settings.temperature;
    document.getElementById('temp-value').textContent = settings.temperature;
    document.getElementById('max-tokens').value = settings.max_tokens;
    document.getElementById('top-p').value = settings.top_p;
    document.getElementById('top-p-value').textContent = settings.top_p;
}

async function createNewSettingsConfig() {
    const name = prompt('Enter a name for the new configuration:', 'New Config');
    if (!name) return;

    try {
        // Get default values
        const defaultsResponse = await fetch('/default_settings');
        const defaults = await defaultsResponse.json();

        const newSettings = {
            name: name,
            ...defaults
        };

        const response = await fetch('/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newSettings)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to create settings');
        }

        const data = await response.json();
        showModal('Success', 'Configuration created successfully!', 'info');

        // Reload settings list and select the new one
        await initializeSettings();
        elements.settingsSelector.value = data.id;
        // Trigger change event to populate form
        elements.settingsSelector.dispatchEvent(new Event('change'));

    } catch (error) {
        console.error('Error creating settings:', error);
        showModal('Error', error.message, 'error');
    }
}

async function handleSettingsChange(e) {
    const settingsId = e.target.value;
    try {
        const response = await fetch(`/settings/${settingsId}`);
        const settings = await response.json();
        populateSettingsForm(settings);

        // Auto-activate the selected configuration
        await setDefaultSettings(true);
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

async function saveSettings() {
    const settings = {
        name: elements.settingsSelector.options[elements.settingsSelector.selectedIndex].text,
        host: document.getElementById('api-host').value,
        api_key: document.getElementById('api-key').value,
        model_name: document.getElementById('model-name').value,
        temperature: parseFloat(document.getElementById('temperature').value),
        max_tokens: parseInt(document.getElementById('max-tokens').value),
        top_p: parseFloat(document.getElementById('top-p').value)
    };

    const settingsId = elements.settingsSelector.value;

    try {
        await fetch(`/settings/${settingsId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        showModal('Success', 'Settings saved successfully!', 'info');
    } catch (error) {
        console.error('Error saving settings:', error);
        showModal('Error', 'Failed to save settings', 'error');
    }
}

async function setDefaultSettings(silent = false) {
    const settingsId = elements.settingsSelector.value;
    try {
        await fetch(`/settings/${settingsId}/set_default`, { method: 'POST' });
        if (!silent) {
            showModal('Success', 'Default settings updated!', 'info');
        }
    } catch (error) {
        console.error('Error setting default:', error);
        if (!silent) {
            showModal('Error', 'Failed to set default settings', 'error');
        }
    }
}

function loadVersion() {
    fetch('/version')
        .then(res => res.json())
        .then(data => {
            document.getElementById('version-display').textContent = `v${data.version}`;
        })
        .catch(console.error);
}

async function regenerateResponse(messageDiv, messageId) {
    showModal('Regenerate Response', 'Are you sure you want to regenerate this response?', 'confirm', async () => {
        const conversationId = state.currentConversationId;
        const systemPrompt = elements.systemPrompt.value;

        // Find the user message before this assistant message
        let userMessage = '';
        let prevSibling = messageDiv.previousElementSibling;
        while (prevSibling) {
            if (prevSibling.classList.contains('justify-end')) { // User message
                userMessage = prevSibling.querySelector('.prose').textContent.trim();
                break;
            }
            prevSibling = prevSibling.previousElementSibling;
        }

        if (!userMessage) {
            console.error('Could not find user message for regeneration');
            return;
        }

        state.abortController = new AbortController();

        // Show loading state
        const contentDiv = messageDiv.querySelector('.message-content');
        contentDiv.innerHTML = '<div class="flex items-center gap-2 text-gray-400"><i class="fa-solid fa-circle-notch fa-spin"></i> Regenerating...</div>';

        try {
            const formData = new FormData();
            formData.append('message', userMessage);
            formData.append('system_prompt', systemPrompt);
            formData.append('conversation_id', conversationId);
            formData.append('message_id', messageId);
            formData.append('client_id', state.clientId);

            const response = await fetch('/regenerate_response', {
                method: 'POST',
                body: formData,
                signal: state.abortController.signal
            });

            if (!response.ok) throw new Error('Regeneration failed');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let responseText = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                responseText += chunk;
                updateAssistantMessage(responseText, messageDiv);
            }

        } catch (error) {
            console.error('Error regenerating:', error);
            contentDiv.textContent = 'Failed to regenerate response.';
            showModal('Error', 'Failed to regenerate response', 'error');
        } finally {
            state.abortController = null;
        }
    });
}
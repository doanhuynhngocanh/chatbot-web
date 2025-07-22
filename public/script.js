let sessionId = localStorage.getItem('sessionId');
if (!sessionId) {
    sessionId = Math.random().toString(36).substring(2);
    localStorage.setItem('sessionId', sessionId);
}

// Store all conversations by sessionId
let allConversations = JSON.parse(localStorage.getItem('allConversations') || '{}');

// Welcome guide options (reset per session)
const defaultWelcomeOptions = [
    "What is the Housing Can't Wait campaign?",
    "How can I get help with housing?",
    "How can I partner or invest?",
    "How can my organization get involved?",
    "Who is Fahe?"
];
let sessionWelcomeOptions = [...defaultWelcomeOptions];

function showWelcomeGuide() {
    let optionsDiv = document.querySelector('.welcome-options');
    if (optionsDiv) optionsDiv.remove(); // Remove any existing options
    let instruction = document.querySelector('.welcome-instruction');
    if (instruction) instruction.remove(); // Remove any existing instruction
    const chatMessages = document.getElementById('chatMessages');
    // Add the options
    if (sessionWelcomeOptions.length > 0) {
        optionsDiv = document.createElement('div');
        optionsDiv.className = 'welcome-options';
        sessionWelcomeOptions.forEach(option => {
            const btn = document.createElement('button');
            btn.className = 'welcome-option-btn';
            btn.textContent = option;
            btn.onclick = function() {
                document.getElementById('userInput').value = option;
                sessionWelcomeOptions = sessionWelcomeOptions.filter(o => o !== option);
                sendMessage();
                optionsDiv.remove();
                instruction && instruction.remove();
            };
            optionsDiv.appendChild(btn);
        });
        chatMessages.appendChild(optionsDiv);
        // Add the instruction line after the options
        instruction = document.createElement('div');
        instruction.className = 'welcome-instruction';
        instruction.textContent = 'Or you can ask your own questions:';
        chatMessages.appendChild(instruction);
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// New Chat button handler
const clearButton = document.getElementById('clearButton');
clearButton.onclick = function() {
    // Save current chat to allConversations
    const chatMessages = document.getElementById('chatMessages');
    allConversations[sessionId] = chatMessages.innerHTML;
    localStorage.setItem('allConversations', JSON.stringify(allConversations));

    // Start a new sessionId
    sessionId = Math.random().toString(36).substring(2);
    localStorage.setItem('sessionId', sessionId);

    // Reset session options
    sessionWelcomeOptions = [...defaultWelcomeOptions];

    // Show welcome message and options
    chatMessages.innerHTML = '';
    addMessage('bot', "Welcome! I'm your AI assistant for the Housing Can't Wait campaign. How can I help you today?");
    showWelcomeGuide();
};

document.getElementById('sendButton').onclick = sendMessage;
document.getElementById('userInput').addEventListener('keydown', function(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        sendMessage();
    }
});

document.getElementById('userInput').addEventListener('input', function() {
    // Remove options when user starts typing
    let optionsDiv = document.querySelector('.welcome-options');
    if (optionsDiv) optionsDiv.remove();
    let instruction = document.querySelector('.welcome-instruction');
    if (instruction) instruction.remove();
});

// Always show welcome guide on first load
window.addEventListener('DOMContentLoaded', function() {
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.innerHTML = '';
    sessionWelcomeOptions = [...defaultWelcomeOptions];
    addMessage('bot', "Welcome! I'm your AI assistant for the Housing Can't Wait campaign. How can I help you today?");
    showWelcomeGuide();
});

async function sendMessage() {
    let optionsDiv = document.querySelector('.welcome-options');
    if (optionsDiv) optionsDiv.remove();
    let instruction = document.querySelector('.welcome-instruction');
    if (instruction) instruction.remove();
    const userInput = document.getElementById('userInput');
    const message = userInput.value.trim();
    if (!message) return;

    // Display user message
    addMessage('user', message);

    // Send to backend
    const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId }),
    });
    const data = await res.json();

    // Display bot reply
    if (typeof data.reply === 'string' && data.reply.includes('Would you like to leave your contact information so we can follow up with you? (yes/no)')) {
        const [mainReply, contactPrompt] = data.reply.split(/\n\n|\n/).filter(Boolean);
        if (mainReply) addMessage('bot', mainReply);
        addMessage('bot', 'Would you like to leave your contact information so we can follow up with you? (yes/no)');
    } else {
        addMessage('bot', data.reply);
    }

    userInput.value = '';
    // Show suggestions again after bot reply
    showWelcomeGuide();
}

function addMessage(role, content) {
    const chatMessages = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = `message ${role === 'user' ? 'user-message' : 'bot-message'}`;
    div.innerHTML = `<div class=\"message-content\">${content}</div><div class=\"message-time\">${new Date().toLocaleTimeString()}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
} 
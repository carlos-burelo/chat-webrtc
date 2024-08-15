class P2PChat {
  constructor() {
    this.peers = new Map();
    this.connections = new Map();
    this.dataChannels = new Map();
    this.localId = Math.random().toString(36).substr(2, 9);
    this.initializeEventListeners();
    this.announcePresence();
    setInterval(() => this.announcePresence(), 5000);
    setInterval(() => this.checkPeersConnection(), 10000);
  }

  initializeEventListeners() {
    window.addEventListener('storage', (event) => {
      if (event.key === 'p2p-chat-messages') {
        const message = JSON.parse(event.newValue);
        this.handleStorageMessage(message);
      }
    });

    document.getElementById('send-button').addEventListener('click', () => this.sendMessage());
    document.getElementById('message-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendMessage();
    });
  }

  announcePresence() {
    this.sendStorageMessage({
      type: 'announce',
      id: this.localId
    });
  }

  sendStorageMessage(message) {
    localStorage.setItem('p2p-chat-messages', JSON.stringify(message));
    localStorage.removeItem('p2p-chat-messages');
  }

  handleStorageMessage(message) {
    try {
      if (message?.type === 'announce' && message.id !== this.localId) {
        this.handleNewPeer(message.id);
      } else if (message?.type === 'offer' && message.target === this.localId) {
        this.handleOffer(message.id, message.offer);
      } else if (message?.type === 'answer' && message.target === this.localId) {
        this.handleAnswer(message.id, message.answer);
      } else if (message?.type === 'ice-candidate' && message.target === this.localId) {
        this.handleNewICECandidate(message.id, message.candidate);
      }
    } catch (error) {
      this.displayError('Error processing message: ' + error.message);
    }
  }

  async handleNewPeer(peerId) {
    if (this.peers.has(peerId)) return;
    this.peers.set(peerId, { id: peerId });
    this.updateUserList();
    try {
      await this.createPeerConnection(peerId);
      this.createOffer(peerId);
    } catch (error) {
      this.displayError('Error handling new peer: ' + error.message);
    }
  }

  async createPeerConnection(peerId) {
    try {
      const peerConnection = new RTCPeerConnection();

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendStorageMessage({
            type: 'ice-candidate',
            id: this.localId,
            target: peerId,
            candidate: event.candidate.toJSON()
          });
        }
      };

      peerConnection.ondatachannel = (event) => {
        this.setupDataChannel(peerId, event.channel);
      };

      peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'disconnected') {
          this.handlePeerDisconnection(peerId);
        }
      };

      this.connections.set(peerId, peerConnection);
    } catch (error) {
      this.displayError('Error creating peer connection: ' + error.message);
    }
  }

  async createOffer(peerId) {
    const peerConnection = this.connections.get(peerId);
    try {
      const dataChannel = peerConnection.createDataChannel('chat');
      this.setupDataChannel(peerId, dataChannel);

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      this.sendStorageMessage({
        type: 'offer',
        id: this.localId,
        target: peerId,
        offer: offer
      });
    } catch (error) {
      this.displayError('Error creating offer: ' + error.message);
    }
  }

  async handleOffer(peerId, offer) {
    if (!this.connections.has(peerId)) {
      await this.createPeerConnection(peerId);
    }
    const peerConnection = this.connections.get(peerId);

    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      this.sendStorageMessage({
        type: 'answer',
        id: this.localId,
        target: peerId,
        answer: answer
      });
    } catch (error) {
      this.displayError('Error handling offer: ' + error.message);
    }
  }

  async handleAnswer(peerId, answer) {
    const peerConnection = this.connections.get(peerId);
    if (peerConnection) {
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (error) {
        this.displayError('Error handling answer: ' + error.message);
      }
    }
  }

  async handleNewICECandidate(peerId, candidateData) {
    const peerConnection = this.connections.get(peerId);
    if (peerConnection) {
      try {
        const candidate = new RTCIceCandidate(candidateData);
        await peerConnection.addIceCandidate(candidate);
      } catch (error) {
        this.displayError('Error adding ICE candidate: ' + error.message);
      }
    }
  }

  setupDataChannel(peerId, channel) {
    channel.onopen = () => {
      console.log(`Connection established with peer ${peerId}`);
      this.updateUserList();
    };
    channel.onclose = () => {
      console.log(`Connection closed with peer ${peerId}`);
      this.handlePeerDisconnection(peerId);
    };
    channel.onerror = (error) => {
      this.displayError(`Data channel error with peer ${peerId}: ${error.message}`);
    };
    channel.onmessage = (event) => this.handleIncomingMessage(peerId, event.data);
    this.dataChannels.set(peerId, channel);
  }

  handleIncomingMessage(peerId, message) {
    this.displayMessage(message, 'received');
  }

  sendMessage() {
    const messageInput = document.getElementById('message-input');
    const message = messageInput.value.trim();
    if (message) {
      this.dataChannels.forEach((channel) => {
        if (channel.readyState === 'open') {
          channel.send(message);
        }
      });
      this.displayMessage(message, 'sent');
      messageInput.value = '';
    }
  }

  displayMessage(message, type) {
    const messagesContainer = document.getElementById('messages');
    const messageElement = document.createElement('div');
    messageElement.textContent = message;
    messageElement.className = `message ${type}`;
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  displayError(message) {
    const messagesContainer = document.getElementById('messages');
    const errorElement = document.createElement('div');
    errorElement.textContent = message;
    errorElement.className = 'error';
    messagesContainer.appendChild(errorElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  updateUserList() {
    const userListContainer = document.getElementById('user-list');
    userListContainer.innerHTML = '<h3>Usuarios Activos</h3>';
    this.peers.forEach((peer) => {
      const userElement = document.createElement('div');
      userElement.textContent = peer.id;
      userElement.className = 'user-item';
      userListContainer.appendChild(userElement);
    });
  }

  handlePeerDisconnection(peerId) {
    this.peers.delete(peerId);
    this.connections.delete(peerId);
    this.dataChannels.delete(peerId);
    this.updateUserList();
    this.displayMessage(`Usuario ${peerId} se ha desconectado.`, 'system');
  }

  checkPeersConnection() {
    this.connections.forEach((connection, peerId) => {
      if (connection.iceConnectionState === 'disconnected' || connection.iceConnectionState === 'failed') {
        this.handlePeerDisconnection(peerId);
      }
    });
  }
}

// Iniciar el chat cuando se cargue la página
window.onload = () => new P2PChat();
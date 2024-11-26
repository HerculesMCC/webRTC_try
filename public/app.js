mdc.ripple.MDCRipple.attachTo(document.querySelector('.mdc-button'));

// DEfault configuration - Change these if you have a different STUN or TURN server.
const configuration = {
  iceServers: [
    {
      urls: [
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ],
    },
  ],
  iceCandidatePoolSize: 10,
};

let peerConnection = null;
let localStream = null;
let remoteStream = null;
let roomDialog = null;
let roomId = null;

function init() {
  document.querySelector('#cameraBtn').addEventListener('click', openUserMedia);
  document.querySelector('#hangupBtn').addEventListener('click', hangUp);
  document.querySelector('#createBtn').addEventListener('click', createRoom);
  document.querySelector('#joinBtn').addEventListener('click', joinRoom);
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));

  // Ajout des listeners vidéo
  const remoteVideo = document.querySelector('#remoteVideo');
  remoteVideo.onloadedmetadata = () => {
    console.log('📺 Metadata chargée');
    remoteVideo.play()
      .then(() => console.log('▶️ Lecture démarrée après metadata'))
      .catch(e => console.error('❌ Erreur lecture:', e));
  };
  remoteVideo.onloadeddata = () => console.log('📺 Data chargée');
  remoteVideo.oncanplay = () => console.log('📺 Peut commencer la lecture');
  remoteVideo.onplaying = () => console.log('📺 Lecture en cours');
  remoteVideo.onerror = (e) => console.error('❌ Erreur vidéo:', e);
}

async function createRoom() { 
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;
  const db = firebase.firestore();

  console.log('Create PeerConnection with configuration: ', configuration);
  peerConnection = new RTCPeerConnection(configuration);

  registerPeerConnectionListeners();

  // Ajout des tracks locaux UNE SEULE FOIS
  localStream.getTracks().forEach(track => {
    console.log('🎥 Caller: Adding track to peer connection:', track.kind);
    peerConnection.addTrack(track, localStream);
  });

  // Création de l'offre et de la salle
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  
  const roomWithOffer = {
      offer: {
          type: offer.type,
          sdp: offer.sdp
      }
  }
  const roomRef = await db.collection('rooms').add(roomWithOffer);
  roomId = roomRef.id;
  document.querySelector('#currentRoom').innerText = `Current room is "${roomId}" - You are the caller!`

  // Collecte des candidats ICE
  await collectIceCandidates(roomRef, peerConnection, 'callerCandidates', 'calleeCandidates');

  // Écoute des modifications de la salle pour la réponse
  roomRef.onSnapshot(async snapshot => {
    const data = snapshot.data();
    console.log('🔍 Snapshot data:', data);
    console.log('🔍 Current remote description:', peerConnection.currentRemoteDescription);
    console.log('🔍 Answer exists:', !!data?.answer);
    
    if (!peerConnection.currentRemoteDescription && data?.answer) {
        console.log('✅ Conditions passed, setting remote description');
        const answer = new RTCSessionDescription(data.answer);
        try {
            await peerConnection.setRemoteDescription(answer);
            console.log('✅ Remote description set successfully');
        } catch (error) {
            console.error('❌ Error setting remote description:', error);
        }
    } else {
        console.log('❌ Conditions not met for setRemoteDescription');
    }
  });

  // Configuration de l'événement track pour recevoir le flux distant
  peerConnection.addEventListener('track', event => {
    console.log('🎥 CALLER: Track reçu', {
        trackType: event.track.kind,
        streamId: event.streams[0].id,
        trackEnabled: event.track.enabled
    });
    
    const remoteVideo = document.querySelector('#remoteVideo');
    
    // N'assignons le srcObject que si ce n'est pas déjà fait
    if (!remoteVideo.srcObject) {
        // Configurons exactement comme localVideo
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        console.log('🎥 CALLER: Video distante configurée', {
            autoplay: remoteVideo.autoplay,
            playsInline: remoteVideo.playsInline,
            srcObject: !!remoteVideo.srcObject
        });
    }
  });

  // Ajoutons des listeners pour tous les événements possibles sur la vidéo distante
  const remoteVideo = document.querySelector('#remoteVideo');
  remoteVideo.onloadedmetadata = () => console.log('📺 Metadata chargée');
  remoteVideo.onloadeddata = () => console.log('📺 Data chargée');
  remoteVideo.oncanplay = () => {
      console.log('📺 Peut commencer la lecture');
      remoteVideo.play()
          .then(() => console.log('▶️ Lecture démarrée'))
          .catch(e => console.error('❌ Erreur lecture:', e));
  };
  remoteVideo.onplaying = () => console.log('📺 Lecture en cours');
  remoteVideo.onerror = (e) => console.error('❌ Erreur vidéo:', e);

  // Ajoutons aussi des listeners pour l'état de la connexion
  peerConnection.onconnectionstatechange = () => {
      console.log('🔌 Connection state:', peerConnection.connectionState);
  };

  peerConnection.oniceconnectionstatechange = () => {
      console.log('🧊 ICE connection state:', peerConnection.iceConnectionState);
  };

  peerConnection.onsignalingstatechange = () => {
      console.log('📡 Signaling state:', peerConnection.signalingState);
  };
}

function joinRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;

  document.querySelector('#confirmJoinBtn').
      addEventListener('click', async () => {
        roomId = document.querySelector('#room-id').value.trim();
        
        // Vérification que l'ID n'est pas vide
        if (!roomId) {
            alert('Veuillez entrer un ID de room valide');
            return;
        }

        console.log('Join room: ', roomId);
        document.querySelector(
            '#currentRoom').innerText = `Current room is "${roomId}" - You are the callee!`;
        await joinRoomById(roomId);
      }, {once: true});
  roomDialog.open();
}

async function joinRoomById(roomId) {
  const db = firebase.firestore();
  const roomRef = db.collection('rooms').doc(`${roomId}`);
  const roomSnapshot = await roomRef.get();

  console.log('Room exists:', roomSnapshot.exists);
  
  // Vérification de l'existence de la room
  if (!roomSnapshot.exists) {
    showError('Cette room n\'existe pas !');
    // Réactiver les boutons
    document.querySelector('#createBtn').disabled = false;
    document.querySelector('#joinBtn').disabled = false;
    // Effacer le message de room courante
    document.querySelector('#currentRoom').innerText = '';
    return;
  }
  
  peerConnection = new RTCPeerConnection(configuration);
  
  // Configuration du stream distant AVANT tout
  remoteStream = new MediaStream();
  document.querySelector('#remoteVideo').srcObject = remoteStream;

  // Gestion des tracks distants
  peerConnection.addEventListener('track', event => {
    console.log('🎥 Callee: Received remote track:', event.streams[0]);
    document.querySelector('#remoteVideo').srcObject = event.streams[0];
  });

  // Ajout des tracks locaux
  localStream.getTracks().forEach(track => {
    console.log('📤 CALLEE: Envoi du track', {
        type: track.kind,
        enabled: track.enabled
    });
    peerConnection.addTrack(track, localStream);
  });

  // Traitement de l'offre
  const offer = roomSnapshot.data().offer;
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  
  // Création et envoi de la réponse
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  console.log('📤 Sending answer to Firestore:', {
    type: answer.type,
    sdp: answer.sdp
  });
  await roomRef.update({
    answer: {
      type: answer.type,
      sdp: answer.sdp
    }
  });
  console.log('📤 Answer sent to Firestore');

  // Gestion des ICE candidates
  await collectIceCandidates(roomRef, peerConnection, 'calleeCandidates', 'callerCandidates');
}

async function openUserMedia(e) {
  const stream = await navigator.mediaDevices.getUserMedia(
      {video: true, audio: true});
  document.querySelector('#localVideo').srcObject = stream;
  localStream = stream;

  
  // Créer un nouveau MediaStream vide
  remoteStream = new MediaStream();
  document.querySelector('#remoteVideo').srcObject = remoteStream;
  
  console.log('LocalS tream:', document.querySelector('#localVideo').srcObject); //log
  console.log('Remote stream:', remoteStream);  //log
  document.querySelector('#cameraBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = false;
  document.querySelector('#createBtn').disabled = false;
  document.querySelector('#hangupBtn').disabled = false;
}

async function hangUp(e) {
  const tracks = document.querySelector('#localVideo').srcObject.getTracks();
  tracks.forEach(track => {
    track.stop();
  });

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
  }

  if (peerConnection) {
    peerConnection.close();
  }

  document.querySelector('#localVideo').srcObject = null;
  document.querySelector('#remoteVideo').srcObject = null;
  document.querySelector('#cameraBtn').disabled = false;
  document.querySelector('#joinBtn').disabled = true;
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#hangupBtn').disabled = true;
  document.querySelector('#currentRoom').innerText = '';

  // Delete room on hangup
  if (roomId) {
    const db = firebase.firestore();
    const roomRef = db.collection('rooms').doc(roomId);
    const calleeCandidates = await roomRef.collection('calleeCandidates').get();
    calleeCandidates.forEach(async candidate => {
      await candidate.delete();
    });
    const callerCandidates = await roomRef.collection('callerCandidates').get();
    callerCandidates.forEach(async candidate => {
      await candidate.delete();
    });
    await roomRef.delete();
  }

  document.location.reload(true);
}

function registerPeerConnectionListeners() {
  peerConnection.addEventListener('icegatheringstatechange', () => {
    console.log(
        `ICE gathering state changed: ${peerConnection.iceGatheringState}`);
  });

  peerConnection.addEventListener('connectionstatechange', () => {
    console.log(`Connection state change: ${peerConnection.connectionState}`);
  });

  peerConnection.addEventListener('signalingstatechange', () => {
    console.log(`Signaling state change: ${peerConnection.signalingState}`);
  });

  peerConnection.addEventListener('iceconnectionstatechange ', () => {
    console.log(
        `ICE connection state change: ${peerConnection.iceConnectionState}`);
  });

  peerConnection.ontrack = (event) => {
    console.log('🎥 ontrack event:', event);
    console.log('🎥 Remote streams:', event.streams);
  };

  peerConnection.onicecandidate = (event) => {
    console.log('🧊 New ICE candidate:', event.candidate);
  };

  peerConnection.onconnectionstatechange = (event) => {
    console.log('🔌 Connection state:', peerConnection.connectionState);
  };
}

async function collectIceCandidates(roomRef, peerConnection, localName, remoteName) {
    // Crée une référence à la collection des candidats ICE locaux
    const candidatesCollection = roomRef.collection(localName);

    // Écoute les candidats ICE générés localement
    peerConnection.addEventListener('icecandidate', event => {
        if (event.candidate) {
            const json = event.candidate.toJSON();
            candidatesCollection.add(json);
        }
    });

    // Écoute les candidats ICE distants
    roomRef.collection(remoteName).onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
            if (change.type === "added") {
                const candidate = new RTCIceCandidate(change.doc.data());
                peerConnection.addIceCandidate(candidate);
            }
        });
    });
}

function showError(message) {
    const errorElement = document.querySelector('#errorMessage');
    errorElement.textContent = message;
    errorElement.classList.add('visible');
    
    // Cacher le message après 5 secondes
    setTimeout(() => {
        errorElement.classList.remove('visible');
    }, 5000);
}

init();

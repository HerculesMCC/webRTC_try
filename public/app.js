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
  console.log('🏠 Création de la room...');
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
    const remoteVideo = document.querySelector('#remoteVideo');
    
    if (!remoteVideo.srcObject) {
        console.log('🎥 Configuration de la vidéo distante...');
        
        // Configuration de base
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        remoteVideo.muted = false;  // S'assurer que ce n'est pas muet
        
        // Fonction de tentative de lecture
        const tryPlay = async () => {
            console.log('🎯 Tentative de lecture...');
            try {
                await remoteVideo.play();
                console.log('✅ Lecture démarrée avec succès');
            } catch (error) {
                console.error('❌ Erreur de lecture:', error);
            }
        };
        
        // Listeners avec tentatives de lecture
        remoteVideo.onloadedmetadata = () => {
            console.log('📺 Metadata chargée');
            tryPlay();
        };
        
        remoteVideo.oncanplay = () => {
            console.log('📺 Peut commencer la lecture');
            tryPlay();
        };
        
        // Vérification immédiate de l'état
        console.log('🔍 État actuel:', {
            readyState: remoteVideo.readyState,
            paused: remoteVideo.paused,
            srcObject: !!remoteVideo.srcObject,
            stream: {
                active: event.streams[0].active,
                tracks: event.streams[0].getTracks().map(t => ({
                    kind: t.kind,
                    enabled: t.enabled,
                    muted: t.muted,
                    readyState: t.readyState
                }))
            }
        });
        
        // Tentative différée
        setTimeout(tryPlay, 1000);
    }
  });

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

async function joinRoom() {
    console.log('🚪 Tentative de rejoindre la room...');
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
            
            // Vérification de l'existence de la room
            const db = firebase.firestore();
            const roomRef = db.collection('rooms').doc(`${roomId}`);
            const roomSnapshot = await roomRef.get();
            
            if (!roomSnapshot.exists) {
                console.error('❌ Cette room n\'existe pas !');
                alert('Cette room n\'existe pas !');
                // Réactiver les boutons
                document.querySelector('#createBtn').disabled = false;
                document.querySelector('#joinBtn').disabled = false;
                return;
            }
            
            console.log('✅ Room trouvée:', roomSnapshot.data());
            
            // Vérifier si la room contient une offre
            const roomData = roomSnapshot.data();
            if (!roomData.offer) {
                console.error('❌ La room ne contient pas d\'offre !');
                alert('La room est invalide (pas d\'offre)');
                return;
            }
            
            console.log('📝 Offre reçue:', roomData.offer);
            
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
    
    peerConnection = new RTCPeerConnection(configuration);
    
    // Configuration du stream distant AVANT tout
    const remoteVideo = document.querySelector('#remoteVideo');
    
    // Gestion des tracks distants
    peerConnection.ontrack = event => {
        console.log('🎥 Track reçu:', {
            kind: event.track.kind,
            readyState: event.track.readyState,
            enabled: event.track.enabled,
            muted: event.track.muted
        });
        
        if (event.track.kind === 'video') {
            console.log('📺 Configuration vidéo distante');
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.autoplay = true;
            remoteVideo.playsInline = true;
            
            // Ajout des listeners pour mieux suivre le chargement
            remoteVideo.onloadedmetadata = () => {
                console.log('📺 Metadata chargée');
                remoteVideo.play()
                    .then(() => console.log('▶️ Lecture démarrée après metadata'))
                    .catch(e => console.error('❌ Erreur lecture:', e));
            };
            
            remoteVideo.onloadeddata = () => console.log('📺 Data chargée');
            remoteVideo.oncanplay = () => {
                console.log('📺 Peut commencer la lecture');
                remoteVideo.play()
                    .then(() => console.log('▶️ Lecture démarrée après canplay'))
                    .catch(e => console.error('❌ Erreur lecture:', e));
            };
            remoteVideo.onplaying = () => console.log('📺 Lecture en cours');
            remoteVideo.onerror = (e) => console.error('❌ Erreur vidéo:', e);
            
            // Forcer la lecture après un court délai
            setTimeout(() => {
                console.log('⏱️ Tentative de lecture forcée');
                remoteVideo.play()
                    .then(() => console.log('▶️ Lecture démarrée après délai'))
                    .catch(e => console.error('❌ Erreur lecture forcée:', e));
            }, 1000);
            
            // Logs détaillés
            console.log('📊 État détaillé de l\'élément vidéo:', {
                srcObject: !!remoteVideo.srcObject,
                autoplay: remoteVideo.autoplay,
                playsInline: remoteVideo.playsInline,
                videoWidth: remoteVideo.videoWidth,
                videoHeight: remoteVideo.videoHeight,
                paused: remoteVideo.paused,
                currentTime: remoteVideo.currentTime,
                readyState: remoteVideo.readyState,
                networkState: remoteVideo.networkState,
                error: remoteVideo.error
            });
        }
    };

    // Ajout des tracks locaux
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Traitement de l'offre
    const offer = roomSnapshot.data().offer;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    await roomRef.update({
        answer: {
            type: answer.type,
            sdp: answer.sdp
        }
    });
}

async function openUserMedia(e) {
  const stream = await navigator.mediaDevices.getUserMedia(
      {video: true, audio: true});
  document.querySelector('#localVideo').srcObject = stream;
  localStream = stream;
  
  console.log('Stream setup:', {
      localStream: !!localStream
  });
  
  document.querySelector('#cameraBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = false;
  document.querySelector('#createBtn').disabled = false;
  document.querySelector('#hangupBtn').disabled = false;
}

async function hangUp(e) {
  // Avant de nettoyer
  console.log('🧹 État avant nettoyage:', {
    remoteVideoHasSource: !!document.querySelector('#remoteVideo').srcObject,
    peerConnection: !!peerConnection
  });

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

  // Après nettoyage
  console.log('🧹 État après nettoyage:', {
    remoteVideoHasSource: !!document.querySelector('#remoteVideo').srcObject
  });
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
    console.log('🎥 Track reçu:', event.track.kind);
    
    if (event.track.kind === 'video') {
        const remoteVideo = document.querySelector('#remoteVideo');
        console.log('📺 Configuration de la vidéo distante');
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        
        // Ajoutons ces lignes pour forcer la lecture et vérifier l'état
        remoteVideo.onloadedmetadata = () => {
            console.log('📊 Métadonnées vidéo chargées');
            remoteVideo.play()
                .then(() => console.log('▶️ Lecture démarrée'))
                .catch(e => console.error('❌ Erreur de lecture:', e));
        };
        
        // Vérifions l'état du stream
        console.log('🌊 État du stream:', {
            active: event.streams[0].active,
            id: event.streams[0].id,
            tracks: event.streams[0].getTracks().map(t => ({
                kind: t.kind,
                enabled: t.enabled,
                muted: t.muted,
                readyState: t.readyState
            }))
        });
    }
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

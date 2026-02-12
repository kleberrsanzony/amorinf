const grantBtn = document.getElementById('grant-btn');
const statusMsg = document.getElementById('status-msg');

grantBtn.addEventListener('click', async () => {
    grantBtn.disabled = true;
    grantBtn.textContent = 'Aguardando permissão...';

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Parar imediatamente - só precisamos da permissão
        stream.getTracks().forEach(t => t.stop());

        statusMsg.className = 'permission-status success';
        statusMsg.textContent = 'Microfone permitido! Esta aba vai fechar automaticamente...';

        // Avisar a extensão que a permissão foi concedida
        chrome.runtime.sendMessage({ action: 'voicePermissionGranted' });

        // Fechar a aba após 1.5s
        setTimeout(() => { window.close(); }, 1500);

    } catch (err) {
        grantBtn.disabled = false;
        grantBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg> Tentar novamente';

        if (err.name === 'NotAllowedError') {
            statusMsg.className = 'permission-status error';
            statusMsg.textContent = 'Permissão negada. Clique em "Tentar novamente" e depois clique em "Permitir" no prompt do navegador.';
        } else if (err.name === 'NotFoundError') {
            statusMsg.className = 'permission-status error';
            statusMsg.textContent = 'Nenhum microfone encontrado no dispositivo.';
        } else {
            statusMsg.className = 'permission-status error';
            statusMsg.textContent = 'Erro: ' + (err.message || 'desconhecido');
        }
    }
});

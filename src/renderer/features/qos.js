// â”€â”€â”€ QoS Modal â”€â”€â”€ 
function openQosModal() {
    $('qosModal')?.classList.add('active'); 
    refreshQosStatus();
}

function closeQosModal() {
    $('qosModal')?.classList.remove('active');
}

async function refreshQosStatus() {
    try {
        const status = await window.electronAPI.qosStatus(); 
        updateQosModalUI(status);
    } catch (err) {
        $("qosStatusTitle").textContent = "Error";
    }
}

function updateQosModalUI(status) {
    const iconWrap = $('qosStatusIconWrap');
    const title = $('qosStatusTitle');
    const tag1 = $('qosStatusTag');
    const tag2 = $('qosStatusTag2');
    const desc = $('qosStatusDesc');
    const disableBtn = $('qosDisableBtn');
    const navBadge = $('qosNavBadge');

    // Reset preset boxes
    [3, 4, 5].forEach(mbps => {
        $(`qosPreset${mbps}`).classList.remove('active');
    });

    if (status.active) {
        iconWrap.innerHTML = `
            <svg width="32" height="32" fill="none" stroke="#4ade80" viewBox="0 0 24 24" stroke-width="1.5">
                <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
            </svg>
        `;
        title.textContent = `${status.throttle} Mbps Throttle`;
        tag1.textContent = 'Active';
        tag1.style.background = 'rgba(74, 222, 128, 0.15)';
        tag1.style.color = '#4ade80';
        tag2.textContent = `~${status.throttle} Mbps`;
        desc.textContent = `Brave.exe is limited to ${status.throttle} Mbps bandwidth`;
        disableBtn.style.display = 'flex';

        navBadge.textContent = `${status.throttle}M`;
        navBadge.style.display = 'inline-block';
        navBadge.style.background = 'rgba(74, 222, 128, 0.15)';
        navBadge.style.color = '#4ade80';

        const activeBox = $(`qosPreset${status.throttle}`);
        if (activeBox) activeBox.classList.add('active');
    } else {
        iconWrap.innerHTML = `
            <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
        `;
        title.textContent = 'No Throttle Active';
        tag1.textContent = 'Full Speed';
        tag1.style.background = '';
        tag1.style.color = '';
        tag2.textContent = 'Unrestricted';
        desc.textContent = 'Brave is running at maximum bandwidth';
        disableBtn.style.display = 'none';
        navBadge.style.display = 'none';
    }
}

async function setQosThrottle(mbps) {
    try {
        const result = await window.electronAPI.qosApply(mbps);
        updateQosModalUI({ active: true, throttle: result.throttle });
        showToast(`Brave throttled to ${mbps} Mbps`);
    } catch (err) {
        showToast(`Failed: ${err.message}`, 'error');
    }
}

async function removeQosThrottle() {
    try {
        await window.electronAPI.qosRemove();
        updateQosModalUI({ active: false });
        showToast('Throttle removed');
    } catch (err) {
        showToast(`Failed: ${err.message}`, 'error');
    }
}

$("qosModal")?.addEventListener("click", (e) => {
  if (e.target.id === "qosModal") closeQosModal();
});

// â”€â”€â”€ Control Panel Modal â”€â”€â”€ 
function openCPModal() {
  console.log("asd");
  document.getElementById("cpModal").classList.add("active");
  checkCpStatus();
}

function closeCpModal() {
    document.getElementById('cpModal').classList.remove('active');
}

function closeCPModal() {
    closeCpModal();
}

async function checkCpStatus() {
    try {
        const status = await window.electronAPI.getCpStatus();
        State.cpLocked = status?.locked || false;
        updateCpUI();
    } catch (err) {
        console.error('Failed to get CP status:', err);
    }
}

function updateCpUI() {
    const iconWrap = document.getElementById('cpStatusIconWrap');
    const title = document.getElementById('cpStatusTitle');
    const tag1 = document.getElementById('cpStatusTag');
    const tag2 = document.getElementById('cpStatusTag2');
    const desc = document.getElementById('cpStatusDesc');
    const lockPreset = document.getElementById('cpPresetLock');
    const unlockPreset = document.getElementById('cpPresetUnlock');
    const disableBtn = document.getElementById('cpDisableBtn');

    if (State.cpLocked) {
        iconWrap.style.background = 'rgba(244,67,54,0.12)';
        iconWrap.style.color = '#f44336';
        title.textContent = 'Control Panel Locked';
        tag1.textContent = 'Blocked';
        tag1.className = 'tag tag-red';
        tag2.textContent = 'Restricted';
        tag2.className = 'tag tag-red';
        desc.textContent = 'Control Panel and Settings are disabled for users';
        
        lockPreset.classList.add('active');
        unlockPreset.classList.remove('active');
        disableBtn.style.display = 'flex';
    } else {
        iconWrap.style.background = 'rgba(76,175,80,0.12)';
        iconWrap.style.color = '#4caf50';
        title.textContent = 'Control Panel Unlocked';
        tag1.textContent = 'Accessible';
        tag1.className = 'tag tag-green';
        tag2.textContent = 'Full Access';
        tag2.className = 'tag tag-green';
        desc.textContent = 'Users can open Control Panel and Settings';
        
        lockPreset.classList.remove('active');
        unlockPreset.classList.add('active');
        disableBtn.style.display = 'none';
    }
}

async function lockControlPanel() {
    try {
        await window.electronAPI.lockControlPanel();
        State.cpLocked = true;
        updateCpUI();
    } catch (err) {
        console.error('Failed to lock Control Panel:', err);
        alert('Failed to lock Control Panel. Make sure launcher is running as admin.');
    }
}

async function unlockControlPanel() {
    try {
        await window.electronAPI.unlockControlPanel();
        State.cpLocked = false;
        updateCpUI();
    } catch (err) {
        console.error('Failed to unlock Control Panel:', err);
        alert('Failed to unlock Control Panel. Make sure launcher is running as admin.');
    }
}

async function openWindowsControlPanel() {
    const btn = $("cpOpenBtn");

    try {
        setLoadingButton(btn, true, "Opening...");
        await window.electronAPI.openWindowsControlPanel();
        showToast("Opening Windows Control Panel", "success");
    } catch (err) {
        console.error('Failed to open Windows Control Panel:', err);
        showToast("Failed to open Windows Control Panel", "error");
    } finally {
        setLoadingButton(btn, false);
    }
}

async function openLocalGroupPolicyEditor() {
    try {
        await window.electronAPI.openLocalGroupPolicyEditor();
        showToast("Opening Local Group Policy Editor", "success");
    } catch (err) {
        console.error('Failed to open Local Group Policy Editor:', err);
        showToast("Failed to open Local Group Policy Editor", "error");
    }
}

$("cpModal")?.addEventListener("click", (e) => {
  if (e.target.id === "cpModal") closeCPModal();
});

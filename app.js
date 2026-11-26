(() => {
  const PREFERRED_LABEL = "203 System Cardenza";
  const MISSING = "__preferred_missing__";
  const BROWSER_TAB = "__browser_tab_audio__";
  const STORAGE_KEY = "goho-web-sound-card-settings-v1";
  const $ = (id) => document.getElementById(id);
  const inputSelect = $("inputDevice");
  const outputSelect = $("outputDevice");
  const outputMode = $("outputMode");
  const inputChannelSelect = $("inputChannel");
  const volumeSlider = $("volumeSlider");
  const state = {
    devices: [], inputInfo: new Map(), inputStream: null, context: null,
    source: null, inputSplitter: null, routeMerger: null, gain: null,
    analyser: null, destination: null, audio: $("monitorAudio"),
    activeInputId: "", inputChannelCount: 0, inputRouteMode: "mono",
    inputRouteStart: 0, animFrame: 0, hasPermission: false,
    busy: false, scanning: false, probeToken: 0,
  };

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch { return {}; }
  }
  function saveSettings(patch) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readSettings(), ...patch })); }
    catch { /* Private browsing may disable storage; audio still works. */ }
  }
  function setStatus(message, tone = "idle") {
    $("statusText").textContent = message;
    $("statusLight").className = `status-light${tone === "active" ? " active" : tone === "warn" ? " warn" : ""}`;
    $("topState").textContent = tone === "active" ? "MONITORING" : tone === "warn" ? "CHECK DEVICE" : "READY";
    $("liveDot").className = `live-dot${tone === "active" ? " active" : tone === "warn" ? " warn" : ""}`;
  }
  function option(value, label, disabled = false) {
    const item = document.createElement("option");
    item.value = value; item.textContent = label; item.disabled = disabled;
    return item;
  }
  function isPreferred(device) {
    const label = (device.label || "").toLowerCase();
    return label.includes("203") && label.includes("cardenza");
  }
  function paintInputBadge(text, connected = false) {
    const badge = $("inputBadge");
    badge.className = `connection-state${connected ? " connected" : ""}`;
    badge.replaceChildren();
    const dot = document.createElement("span"); dot.className = "badge-dot";
    const copy = document.createElement("span"); copy.textContent = text;
    badge.append(dot, copy);
  }
  function renderInputs(devices) {
    const inputs = devices.filter((device) => device.kind === "audioinput");
    const labelsVisible = inputs.some((device) => device.label.trim());
    const settings = readSettings();
    const preferred = inputs.find(isPreferred);
    const oldChoice = inputSelect.value;
    const savedId = oldChoice && oldChoice !== MISSING ? oldChoice : settings.inputId;
    const savedIsPresent = savedId === BROWSER_TAB || inputs.some((device) => device.deviceId === savedId);
    inputSelect.replaceChildren();

    if (savedId && !savedIsPresent && savedId !== preferred?.deviceId) {
      inputSelect.append(option(savedId, "上次选择的输入设备 · 未连接", true));
    }
    if (!preferred) inputSelect.append(option(MISSING, `${PREFERRED_LABEL} · 未连接`, true));
    for (const [index, device] of inputs.entries()) {
      const info = state.inputInfo.get(device.deviceId);
      const channelText = info?.availableChannels ? ` · ${info.availableChannels} ch` : "";
      const hiddenLabel = labelsVisible || state.hasPermission ? "" : " · 名称需扫描授权";
      const label = `${device.label.trim() || `音频输入设备 ${index + 1}${hiddenLabel}`}${channelText}`;
      inputSelect.append(option(device.deviceId, label));
    }
    if (!inputs.length) inputSelect.append(option("__no_input__", "未检测到输入设备", true));
    if (navigator.mediaDevices?.getDisplayMedia) {
      inputSelect.append(option(BROWSER_TAB, "浏览器标签页声音 · 启用时选择标签页"));
    }

    const desired = savedId === BROWSER_TAB ? BROWSER_TAB
      : savedIsPresent ? savedId : preferred?.deviceId || MISSING;
    inputSelect.value = desired;
    if (inputSelect.value !== desired) inputSelect.value = MISSING;
    inputSelect.disabled = !inputs.length && !navigator.mediaDevices?.getDisplayMedia;
    if (inputSelect.value === BROWSER_TAB) paintInputBadge("标签页输入");
    else if (preferred) paintInputBadge("已连接", true);
    else paintInputBadge("未连接");
    if (labelsVisible) state.hasPermission = true;
    return { preferred, labelsVisible };
  }
  function renderOutputs(devices) {
    const outputs = devices.filter((device) => device.kind === "audiooutput" && device.deviceId && device.deviceId !== "default");
    const settings = readSettings();
    const oldChoice = outputSelect.value;
    const selected = oldChoice || settings.outputId || "";
    outputSelect.replaceChildren(option("", "系统默认输出设备"));
    const present = outputs.some((device) => device.deviceId === selected);
    if (selected && !present) outputSelect.append(option(selected, "上次选择的输出设备 · 未连接", true));
    for (const [index, device] of outputs.entries()) {
      outputSelect.append(option(device.deviceId, device.label.trim() || `Audio output ${index + 1}`));
    }
    outputSelect.value = selected && !present ? selected : selected;
  }
  async function scanDevices({ quiet = false, requestPermission = false } = {}) {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setStatus("当前浏览器不支持声卡扫描，请使用最新版 Chrome、Edge 或 Safari。", "warn");
      return;
    }
    if (state.scanning) return;
    state.scanning = true;
    $("scanButton").disabled = true;
    $("startButton").disabled = true;
    if (!quiet) setStatus("正在扫描声卡与输入通道；不会开始监听。", state.inputStream ? "active" : "idle");
    let permissionStream;
    let permissionError;
    try {
      if (requestPermission && !state.hasPermission && navigator.mediaDevices.getUserMedia) {
        try {
          permissionStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            video: false,
          });
          state.hasPermission = true;
        } catch (error) {
          permissionError = error;
        } finally {
          permissionStream?.getTracks().forEach((track) => track.stop());
          permissionStream = null;
        }
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      state.devices = devices;
      const inputInfo = renderInputs(devices);
      renderOutputs(devices);
      if (state.activeInputId && state.activeInputId !== BROWSER_TAB && !devices.some((device) => device.kind === "audioinput" && device.deviceId === state.activeInputId)) {
        await stopMonitoring({ message: `${PREFERRED_LABEL} 已断开，请重新扫描设备。` });
      }
      const selectedId = inputSelect.value;
      if (selectedId === BROWSER_TAB) {
        renderInputChannelOptions(state.inputInfo.get(BROWSER_TAB)?.actualChannels || 0, BROWSER_TAB);
      } else if (selectedId && selectedId !== MISSING && selectedId !== "__no_input__" && state.hasPermission) {
        if (state.activeInputId === selectedId && state.inputStream) {
          const info = audioTrackInfo(state.inputStream.getAudioTracks()[0]);
          state.inputInfo.set(selectedId, info);
          renderInputs(state.devices);
          inputChannelSelect.value = inputChannelSelect.value || "";
        } else {
          await probeInputChannels(selectedId, { quiet: true });
        }
      }
      if (!quiet) {
        if (permissionError?.name === "NotAllowedError") {
          setStatus("麦克风权限未授予；仍可选择浏览器标签页声音，或在浏览器设置中允许麦克风后重扫。", "warn");
        } else if (!inputInfo.labelsVisible) {
          setStatus(`扫描到 ${devices.filter((device) => device.kind === "audioinput").length} 个输入设备；浏览器仍隐藏设备名称，请选择设备后读取通道。`, "warn");
        } else if (state.inputStream) {
          const activeLabel = state.inputStream.getAudioTracks()[0]?.label || inputSelect.selectedOptions[0]?.textContent || "输入设备";
          setStatus(`扫描完成 · ${activeLabel} 仍在监听。`, "active");
        } else if (selectedId === BROWSER_TAB) {
          setStatus("浏览器标签页声音已选择；启用声卡后选择标签页并允许共享音频。");
        } else if (selectedId === MISSING || !selectedId) {
          setStatus(`${PREFERRED_LABEL} 未连接；可选择其他输入，或使用浏览器标签页声音。`, "warn");
        } else {
          const info = state.inputInfo.get(inputSelect.value);
          setStatus(info?.availableChannels
            ? `${inputSelect.selectedOptions[0]?.textContent} · 已读取通道；启用声卡开始监听。`
            : `${inputSelect.selectedOptions[0]?.textContent || "所选输入设备"} 已扫描；尚未读取到通道信息，请检查权限后重扫。`, info ? "idle" : "warn");
        }
      }
    } catch (error) {
      setStatus(`扫描失败：${error.message || error}`, "warn");
    } finally {
      permissionStream?.getTracks().forEach((track) => track.stop());
      state.scanning = false;
      $("scanButton").disabled = false;
      $("startButton").disabled = state.busy;
    }
  }
  function updateGain() {
    const percent = Number(volumeSlider.value);
    $("volumeValue").textContent = String(percent);
    volumeSlider.style.setProperty("--level", `${percent / 3}%`);
    if (state.gain && state.context) state.gain.gain.setTargetAtTime(percent / 100, state.context.currentTime, 0.012);
    saveSettings({ volume: percent });
  }
  function updateOutputMode() {
    saveSettings({ outputMode: outputMode.value });
    if (!state.context || !state.destination) return;
    const channels = outputMode.value === "stereo" ? 2 : 1;
    try {
      state.destination.channelCount = channels;
      state.destination.channelCountMode = "explicit";
      state.destination.channelInterpretation = "speakers";
    } catch (error) {
      setStatus(`无法切换输出声道：${error.message || error}`, "warn");
    }
  }
  async function setOutputDevice(deviceId) {
    saveSettings({ outputId: deviceId });
    if (!state.audio.srcObject || typeof state.audio.setSinkId !== "function") return;
    try {
      await state.audio.setSinkId(deviceId);
      setStatus(deviceId ? "输出设备已切换。" : "正在使用系统默认输出设备。", state.inputStream ? "active" : "idle");
    } catch (error) {
      setStatus(`无法切换输出设备：${error.message || error}`, "warn");
    }
  }
  async function chooseOutputDevice() {
    if (typeof navigator.mediaDevices?.selectAudioOutput !== "function") {
      setStatus("此浏览器不支持输出设备授权选择；可从已列出的设备中切换。", "warn");
      return;
    }
    try {
      const selected = await navigator.mediaDevices.selectAudioOutput();
      if (selected?.deviceId) {
        const outputId = selected.deviceId === "default" ? "" : selected.deviceId;
        state.devices = [...state.devices.filter((device) => device.deviceId !== selected.deviceId), selected];
        renderOutputs(state.devices);
        outputSelect.value = outputId;
        await setOutputDevice(outputId);
        if (!state.inputStream) setStatus(`${selected.label || "输出设备"} 已选择。启用声卡后开始监听。`);
      }
    } catch (error) {
      if (error.name !== "NotAllowedError") setStatus(`无法选择输出设备：${error.message || error}`, "warn");
    }
  }
  function animateMeter() {
    cancelAnimationFrame(state.animFrame);
    if (!state.analyser) return;
    const samples = new Float32Array(state.analyser.fftSize);
    const draw = () => {
      if (!state.analyser) return;
      state.analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      const height = Math.min(100, Math.max(0, 20 * Math.log10(rms + 1e-5) + 100));
      $("meterLeft").style.height = `${height}%`;
      $("meterRight").style.height = `${height}%`;
      state.animFrame = requestAnimationFrame(draw);
    };
    draw();
  }
  function channelRangeMaximum(value) {
    if (Number.isFinite(value)) return Number(value);
    if (value && Number.isFinite(value.max)) return Number(value.max);
    if (value && Number.isFinite(value.min)) return Number(value.min);
    return 0;
  }
  function audioTrackInfo(track) {
    const settings = track?.getSettings?.() || {};
    const capabilities = track?.getCapabilities?.() || {};
    const actualChannels = Number(settings.channelCount) || 0;
    const maxChannels = channelRangeMaximum(capabilities.channelCount);
    return {
      actualChannels,
      maxChannels,
      availableChannels: Math.min(32, Math.max(actualChannels, maxChannels)),
      sampleRate: Number(settings.sampleRate) || 0,
    };
  }
  function renderInputChannelOptions(channelCount, deviceId) {
    const count = Math.max(0, Math.min(32, Number(channelCount) || 0));
    const previous = inputChannelSelect.dataset.deviceId === deviceId ? inputChannelSelect.value : "";
    const storedRoutes = readSettings().inputRoutes || {};
    inputChannelSelect.replaceChildren();
    if (!count) {
      const label = deviceId === BROWSER_TAB
        ? "启用后读取标签页通道"
        : "扫描后读取设备通道";
      inputChannelSelect.append(option("", label, true));
      inputChannelSelect.disabled = true;
      inputChannelSelect.dataset.deviceId = deviceId || "";
      return;
    }
    for (let channel = 0; channel < count; channel += 1) {
      inputChannelSelect.append(option("mono:" + channel, "单声道 · CH " + (channel + 1)));
    }
    for (let first = 0; first + 1 < count; first += 1) {
      inputChannelSelect.append(option("stereo:" + first, "立体声 · CH " + (first + 1) + "-" + (first + 2)));
    }
    const saved = previous || storedRoutes[deviceId] || "";
    const valid = Array.from(inputChannelSelect.options).some((item) => item.value === saved);
    inputChannelSelect.value = valid ? saved : count >= 2 ? "stereo:0" : "mono:0";
    inputChannelSelect.disabled = false;
    inputChannelSelect.dataset.deviceId = deviceId || "";
  }
  async function probeInputChannels(deviceId, { quiet = false } = {}) {
    if (!deviceId || deviceId === MISSING || deviceId === BROWSER_TAB || !state.hasPermission) return null;
    if (state.activeInputId === deviceId && state.inputStream) {
      const info = audioTrackInfo(state.inputStream.getAudioTracks()[0]);
      state.inputInfo.set(deviceId, info);
      renderInputs(state.devices);
      renderInputChannelOptions(info.availableChannels, deviceId);
      return info;
    }
    const token = ++state.probeToken;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          channelCount: { ideal: 32 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      const info = audioTrackInfo(stream.getAudioTracks()[0]);
      if (token !== state.probeToken) return null;
      state.inputInfo.set(deviceId, info);
      renderInputs(state.devices);
      inputSelect.value = deviceId;
      renderInputChannelOptions(info.availableChannels, deviceId);
      if (!quiet) {
        setStatus(info.availableChannels
          ? inputSelect.selectedOptions[0].textContent + " · 已读取 " + info.availableChannels + " 个可用通道。"
          : "浏览器没有报告该设备的输入通道数。", info.availableChannels ? "idle" : "warn");
      }
      return info;
    } catch (error) {
      if (token === state.probeToken) {
        state.inputInfo.delete(deviceId);
        renderInputChannelOptions(0, deviceId);
        if (!quiet) setStatus("读取输入通道失败：" + (error.message || error), "warn");
      }
      return null;
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }
  async function getPhysicalInputStream(deviceId) {
    const info = state.inputInfo.get(deviceId);
    const requestedChannels = info?.availableChannels || 32;
    const audio = {
      deviceId: { exact: deviceId },
      channelCount: info?.availableChannels
        ? { exact: requestedChannels }
        : { ideal: requestedChannels },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    try {
      return await navigator.mediaDevices.getUserMedia({ audio, video: false });
    } catch (error) {
      if (!info?.availableChannels || requestedChannels <= 1) throw error;
      return navigator.mediaDevices.getUserMedia({
        audio: { ...audio, channelCount: { ideal: requestedChannels } },
        video: false,
      });
    }
  }
  async function getBrowserTabAudioStream() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("当前浏览器不支持浏览器标签页声音捕获。");
    }
    const audio = {
      channelCount: { ideal: 32 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio,
        selfBrowserSurface: "exclude",
        systemAudio: "exclude",
        monitorTypeSurfaces: "exclude",
        preferCurrentTab: false,
      });
    } catch (error) {
      if (error?.name !== "TypeError") throw error;
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio });
    }
    const videoTrack = stream.getVideoTracks()[0];
    const surface = videoTrack?.getSettings?.().displaySurface;
    if (surface && surface !== "browser") {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("请在浏览器分享窗口中选择“浏览器标签页”。");
    }
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("所选标签页没有共享声音；请在浏览器分享窗口中勾选标签页音频。");
    }
    videoTrack?.stop();
    return stream;
  }
  function applyInputRoute() {
    if (!state.inputSplitter || !state.routeMerger || !state.gain) return;
    const pieces = String(inputChannelSelect.value || "").split(":");
    const mode = pieces[0];
    const first = Number(pieces[1]);
    if (!Number.isInteger(first) || first < 0) throw new Error("请先扫描并选择可用输入通道。");
    const required = mode === "stereo" ? first + 2 : first + 1;
    if (required > state.inputChannelCount) {
      throw new Error("当前输入流通道数不足，无法读取所选通道。");
    }
    state.inputSplitter.disconnect();
    state.routeMerger.disconnect();
    if (mode === "stereo") {
      state.inputSplitter.connect(state.routeMerger, first, 0);
      state.inputSplitter.connect(state.routeMerger, first + 1, 1);
    } else if (mode === "mono") {
      state.inputSplitter.connect(state.routeMerger, first, 0);
      state.inputSplitter.connect(state.routeMerger, first, 1);
    } else {
      throw new Error("未知的输入通道模式。");
    }
    state.routeMerger.connect(state.gain);
    state.inputRouteMode = mode;
    state.inputRouteStart = first;
    const settings = readSettings();
    const routes = { ...(settings.inputRoutes || {}), [state.activeInputId]: inputChannelSelect.value };
    saveSettings({ inputRoutes: routes });
  }
  async function connectInput(deviceId, browserTabStream = null) {
    if (!deviceId || deviceId === MISSING || deviceId === "__no_input__") {
      throw new Error("请先扫描设备并选择一个输入，或选择浏览器标签页声音。");
    }
    if (state.inputStream) {
      state.inputStream.getTracks().forEach((track) => track.stop());
      state.inputStream = null;
    }
    cleanupGraph();
    const stream = deviceId === BROWSER_TAB
      ? await (browserTabStream || getBrowserTabAudioStream())
      : await getPhysicalInputStream(deviceId);
    state.inputStream = stream;
    state.activeInputId = deviceId;
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error("输入流没有可用的音轨。");
    track.addEventListener("ended", () => {
      if (state.inputStream === stream) stopMonitoring({ message: "输入设备已断开。" });
    }, { once: true });
    if (deviceId !== BROWSER_TAB) state.hasPermission = true;
    const info = audioTrackInfo(track);
    const actualChannels = info.actualChannels || info.availableChannels;
    if (!actualChannels) throw new Error("浏览器没有报告输入通道数，无法安全配置声道。");
    state.inputChannelCount = actualChannels;
    state.inputInfo.set(deviceId, { ...info, actualChannels, availableChannels: actualChannels });
    renderInputs(state.devices);
    inputSelect.value = deviceId;
    renderInputChannelOptions(actualChannels, deviceId);
    state.source = state.context.createMediaStreamSource(stream);
    state.inputSplitter = state.context.createChannelSplitter(actualChannels);
    state.inputSplitter.channelInterpretation = "discrete";
    state.routeMerger = state.context.createChannelMerger(2);
    state.routeMerger.channelInterpretation = "discrete";
    state.gain = state.context.createGain();
    state.gain.gain.value = Number(volumeSlider.value) / 100;
    state.analyser = state.context.createAnalyser();
    state.analyser.fftSize = 512;
    state.destination = state.context.createMediaStreamDestination();
    state.source.connect(state.inputSplitter);
    applyInputRoute();
    state.gain.connect(state.analyser);
    state.analyser.connect(state.destination);
    updateOutputMode();
    state.audio.srcObject = state.destination.stream;
    const selectedOutput = outputSelect.value;
    if (typeof state.audio.setSinkId === "function") await state.audio.setSinkId(selectedOutput);
    else if (selectedOutput) throw new Error("此浏览器不支持选择输出设备，请使用系统默认输出或更新浏览器。");
    await state.audio.play();
    const settings = track.getSettings();
    const rate = settings.sampleRate ? ` · ${settings.sampleRate} Hz` : "";
    const routeText = inputChannelSelect.selectedOptions[0]?.textContent || (actualChannels + " ch");
    $("startLabel").textContent = "停止监听";
    $("startButton").classList.add("running");
    $("permissionNote").textContent = "监听已启用 · " + routeText + rate + " · 音频仅在本机处理";
    paintInputBadge("监听中", true);
    const sourceLabel = track.label || (deviceId === BROWSER_TAB ? "浏览器标签页声音" : PREFERRED_LABEL);
    setStatus(sourceLabel + " · " + routeText + " 正在监听。", "active");
    animateMeter();
  }
  function cleanupGraph() {
    cancelAnimationFrame(state.animFrame);
    state.animFrame = 0;
    for (const node of [state.source, state.inputSplitter, state.routeMerger, state.gain, state.analyser, state.destination]) {
      try { node?.disconnect(); } catch { /* Already disconnected. */ }
    }
    state.source = state.inputSplitter = state.routeMerger = state.gain = state.analyser = state.destination = null;
    state.activeInputId = "";
    state.inputChannelCount = 0;
    state.audio.pause();
    state.audio.srcObject = null;
    $("meterLeft").style.height = "0";
    $("meterRight").style.height = "0";
  }
  async function stopMonitoring({ message = "监听已停止。" } = {}) {
    cleanupGraph();
    if (state.inputStream) state.inputStream.getTracks().forEach((track) => track.stop());
    state.inputStream = null;
    if (state.context) {
      const context = state.context;
      state.context = null;
      try { await context.close(); } catch { /* Context may already be closed. */ }
    }
    $("startLabel").textContent = "启用声卡";
    $("startButton").classList.remove("running");
    $("permissionNote").textContent = "先扫描读取设备与通道；启用声卡后才会开始输出。";
    paintInputBadge(inputSelect.value === BROWSER_TAB ? "标签页输入" : "等待启用");
    setStatus(message, "idle");
  }
  async function startMonitoring() {
    if (state.busy) return;
    if (state.inputStream) { await stopMonitoring(); return; }
    if (state.scanning) return;
    if (!window.isSecureContext) {
      setStatus("音频输入需要 HTTPS 安全连接。", "warn");
      return;
    }
    const deviceId = inputSelect.value;
    const browserTab = deviceId === BROWSER_TAB;
    if (browserTab && !navigator.mediaDevices?.getDisplayMedia) {
      setStatus("当前浏览器不支持标签页声音捕获。", "warn");
      return;
    }
    if (!browserTab && !navigator.mediaDevices?.getUserMedia) {
      setStatus("当前浏览器不支持音频输入。", "warn");
      return;
    }
    if (!deviceId || deviceId === MISSING || deviceId === "__no_input__") {
      setStatus("请先点击「扫描声卡」并选择一个输入设备。", "warn");
      return;
    }
    state.busy = true;
    let pendingBrowserTabStream = null;
    $("startButton").disabled = true;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio。");
      state.context = new AudioContextClass({ latencyHint: "interactive" });
      pendingBrowserTabStream = browserTab ? getBrowserTabAudioStream() : null;
      await state.context.resume();
      saveSettings({ inputId: deviceId });
      await connectInput(deviceId, pendingBrowserTabStream);
    } catch (error) {
      pendingBrowserTabStream?.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => {});
      const message = error.name === "NotAllowedError"
        ? "浏览器未允许音频捕获；请允许麦克风或标签页音频后重试。"
        : "无法启用声卡：" + (error.message || error);
      await stopMonitoring({ message });
    } finally {
      state.busy = false;
      $("startButton").disabled = state.scanning;
    }
  }
  inputSelect.addEventListener("change", async () => {
    saveSettings({ inputId: inputSelect.value });
    const deviceId = inputSelect.value;
    if (deviceId === BROWSER_TAB) {
      renderInputChannelOptions(state.inputInfo.get(BROWSER_TAB)?.actualChannels || 0, BROWSER_TAB);
      if (!state.inputStream) {
        paintInputBadge("标签页输入");
        setStatus("点击「启用声卡」后，在浏览器分享窗口中选择标签页并允许共享音频。");
        return;
      }
    } else if (!state.hasPermission && !state.inputStream) {
      renderInputChannelOptions(0, deviceId);
      setStatus("点击「扫描声卡」读取所选设备的通道信息。", "warn");
      return;
    }
    if (deviceId && deviceId !== MISSING && deviceId !== "__no_input__" && state.inputStream) {
      state.busy = true;
      $("startButton").disabled = true;
      try { await connectInput(deviceId); }
      catch (error) { await stopMonitoring({ message: "输入切换失败：" + (error.message || error) }); }
      finally { state.busy = false; $("startButton").disabled = state.scanning; }
    } else if (deviceId && deviceId !== BROWSER_TAB && deviceId !== MISSING && deviceId !== "__no_input__") {
      await probeInputChannels(deviceId);
    }
  });
  inputChannelSelect.addEventListener("change", () => {
    const settings = readSettings();
    const routes = { ...(settings.inputRoutes || {}), [inputSelect.value]: inputChannelSelect.value };
    saveSettings({ inputRoutes: routes });
    if (state.inputStream && state.activeInputId === inputSelect.value) {
      try {
        applyInputRoute();
        const name = inputChannelSelect.selectedOptions[0]?.textContent || "输入通道";
        $("permissionNote").textContent = "监听已启用 · " + name + " · 音频仅在本机处理";
        setStatus(name + " 正在监听。", "active");
      } catch (error) {
        setStatus("无法切换输入通道：" + (error.message || error), "warn");
      }
    } else {
      setStatus((inputChannelSelect.selectedOptions[0]?.textContent || "输入通道") + " 已选择；启用声卡开始监听。");
    }
  });
  outputSelect.addEventListener("change", () => setOutputDevice(outputSelect.value));
  $("chooseOutputButton").addEventListener("click", chooseOutputDevice);
  outputMode.addEventListener("change", updateOutputMode);
  volumeSlider.addEventListener("input", updateGain);
  $("scanButton").addEventListener("click", () => scanDevices({ requestPermission: true }));
  $("startButton").addEventListener("click", startMonitoring);
  navigator.mediaDevices?.addEventListener?.("devicechange", () => scanDevices({ quiet: true }));

  const settings = readSettings();
  if (Number.isFinite(settings.volume)) volumeSlider.value = String(Math.max(0, Math.min(300, settings.volume)));
  if (settings.outputMode === "mono" || settings.outputMode === "stereo") outputMode.value = settings.outputMode;
  updateGain();
  scanDevices({ quiet: true });
})();

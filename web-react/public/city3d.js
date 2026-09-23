(() => {
  const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  const DISTRICTS = [
    { name: "Сарыарка", x: -13, z: -8, seed: 3 },
    { name: "Байконур", x: 12, z: -9, seed: 7 },
    { name: "Алматы", x: 19, z: 1, seed: 11 },
    { name: "Есиль", x: -8, z: 13, seed: 17 },
    { name: "Нура", x: 9, z: 17, seed: 23 }
  ];
  const INDICATORS = {
    T1: "Разгрузка дорог",
    T2: "Доступность общественного транспорта",
    E1: "Озеленение",
    E2: "Качество воздуха",
    S1: "Школы и детсады",
    S2: "Поликлиники",
    B1: "Безопасность улиц",
    B2: "Безопасность дорожного движения",
    C1: "Надёжность ЖКХ",
    C2: "Скорость решения обращений"
  };
  const PALETTE = {
    ground: "#102F35",
    block: "#21464A",
    cream: "#F4F1E9",
    gold: "#D4B978",
    low: "#A04436",
    medium: "#875D20",
    good: "#BFD1AE",
    high: "#376849",
    river: "#367A7B"
  };
  const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let previousFetch = null;
  let fetchWrapped = false;
  let booted = false;
  let observer = null;

  function install() {
    if (typeof window === "undefined" || !window.document) return;
    if (!window.fetch || fetchWrapped) return;
    previousFetch = window.fetch.bind(window);
    window.fetch = function (...args) {
      const request = args[0];
      const url = typeof request === "string" ? request : request && request.url;
      const responsePromise = previousFetch(...args);
      if (typeof url === "string" && /\/api\/(simulate|explain)(?:[?#]|$)/.test(url)) {
        responsePromise.then((response) => {
          try {
            if (!response || !response.ok || !response.clone) return;
            response.clone().json().then((payload) => {
              if (payload && payload.simulation) payload = payload.simulation;
              if (payload && Array.isArray(payload.districts)) {
                window.dispatchEvent(new CustomEvent("city3d:simulation", { detail: payload }));
              }
            }).catch(() => {});
          } catch (_) {}
        }).catch(() => {});
      }
      return responsePromise;
    };
    fetchWrapped = true;
  }

  function waitForContainer() {
    if (booted || !document.documentElement) return;
    const container = document.getElementById("city-3d");
    if (container) {
      booted = true;
      if (observer) observer.disconnect();
      loadThree(container);
      return;
    }
    if (!observer) {
      observer = new MutationObserver(waitForContainer);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  function loadThree(container) {
    if (!container || !container.isConnected || !window.WebGLRenderingContext) return;
    if (window.THREE) {
      startScene(container, window.THREE);
      return;
    }
    const script = document.createElement("script");
    script.src = THREE_URL;
    script.async = true;
    script.onload = () => {
      if (window.THREE && container.isConnected) startScene(container, window.THREE);
    };
    script.onerror = () => {};
    (document.head || document.documentElement).appendChild(script);
  }

  function scoreColor(score) {
    if (score < 40) return PALETTE.low;
    if (score < 55) return PALETTE.medium;
    if (score <= 65) return PALETTE.good;
    return PALETTE.high;
  }

  function startScene(container, THREE) {
    if (!container || !container.isConnected || !THREE || !THREE.WebGLRenderer) return;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    } catch (_) {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.domElement.setAttribute("aria-label", "Интерактивная 3D-карта районов Астаны");
    Object.assign(renderer.domElement.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block" });
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    container.style.overflow = "hidden";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x102f35, 0.012);
    const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 180);
    camera.position.set(37, 38, 47);
    const city = new THREE.Group();
    scene.add(city);
    scene.add(new THREE.HemisphereLight(0xf4e4cb, 0x21464a, 1.2));
    const sunset = new THREE.DirectionalLight(0xffd5a1, 2.3);
    sunset.position.set(-22, 32, -18);
    sunset.castShadow = true;
    sunset.shadow.mapSize.set(1024, 1024);
    sunset.shadow.camera.left = -42;
    sunset.shadow.camera.right = 42;
    sunset.shadow.camera.top = 42;
    sunset.shadow.camera.bottom = -42;
    city.add(sunset);
    const fill = new THREE.DirectionalLight(0xb3d5d1, 0.7);
    fill.position.set(25, 17, 24);
    city.add(fill);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(72, 62), new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.3, 2);
    ground.receiveShadow = true;
    city.add(ground);

    const riverPoints = [new THREE.Vector3(-38, 0, 5), new THREE.Vector3(-20, 0, 3.2), new THREE.Vector3(-6, 0, 5.8), new THREE.Vector3(7, 0, 4.1), new THREE.Vector3(22, 0, 7.3), new THREE.Vector3(38, 0, 6)];
    const riverCurve = new THREE.CatmullRomCurve3(riverPoints);
    const riverShape = new THREE.Shape();
    const riverSamples = riverCurve.getPoints(60);
    const bank = 2.1;
    const leftBank = [];
    const rightBank = [];
    riverSamples.forEach((point, index) => {
      const before = riverSamples[Math.max(0, index - 1)];
      const after = riverSamples[Math.min(riverSamples.length - 1, index + 1)];
      const dx = after.x - before.x;
      const dz = after.z - before.z;
      const length = Math.hypot(dx, dz) || 1;
      leftBank.push(new THREE.Vector3(point.x - dz / length * bank, 0, point.z + dx / length * bank));
      rightBank.push(new THREE.Vector3(point.x + dz / length * bank, 0, point.z - dx / length * bank));
    });
    leftBank.forEach((point, index) => index === 0 ? riverShape.moveTo(point.x, point.z) : riverShape.lineTo(point.x, point.z));
    rightBank.reverse().forEach((point) => riverShape.lineTo(point.x, point.z));
    riverShape.closePath();
    const river = new THREE.Mesh(new THREE.ShapeGeometry(riverShape), new THREE.MeshStandardMaterial({ color: PALETTE.river, roughness: 0.35, metalness: 0.12, transparent: true, opacity: 0.87 }));
    river.rotation.x = Math.PI / 2;
    river.position.y = 0.015;
    city.add(river);

    const districtMeshes = new Map();
    const labelNodes = new Map();
    const districtRecords = new Map();
    const clusters = [];
    DISTRICTS.forEach((district, districtIndex) => {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(15, 0.26, 11), new THREE.MeshStandardMaterial({ color: PALETTE.block, roughness: 0.92 }));
      pad.position.set(district.x, -0.06, district.z);
      pad.receiveShadow = true;
      pad.userData.districtName = district.name;
      city.add(pad);
      districtMeshes.set(district.name, pad);
      const placements = [];
      for (let index = 0; index < 40; index += 1) {
        const col = index % 8;
        const row = Math.floor(index / 8);
        const jitterX = Math.sin((index + 1) * (district.seed + 1)) * 0.38;
        const jitterZ = Math.cos((index + 2) * (district.seed + 2)) * 0.32;
        const x = district.x - 5.6 + col * 1.55 + jitterX;
        const z = district.z - 3.6 + row * 1.8 + jitterZ;
        if (Math.abs(z - 5.2) < 3.3) continue;
        const width = 0.58 + (index % 3) * 0.08;
        const depth = 0.62 + (index % 4) * 0.07;
        const baseHeight = 1.25 + ((index * 17 + district.seed * 3) % 13) * 0.23;
        placements.push({ x, z, width, depth, baseHeight, variation: 0.68 + (index % 7) * 0.055, district: district.name, index });
      }
      clusters.push({ district: district.name, placements, targetScore: 55, currentScore: 55, startScore: 55, transitionStart: 0, fromScore: 55, alertUntil: 0 });
      const label = document.createElement("div");
      label.className = "city3d-district-label";
      label.setAttribute("role", "button");
      label.setAttribute("tabindex", "0");
      label.setAttribute("aria-label", `Показатели района ${district.name}`);
      Object.assign(label.style, { position: "absolute", zIndex: "2", transform: "translate(-50%, -50%)", color: PALETTE.cream, background: "rgba(16,47,53,.88)", border: "1px solid rgba(212,185,120,.6)", borderRadius: "999px", padding: "5px 10px", font: "600 12px/1.2 system-ui,sans-serif", whiteSpace: "nowrap", cursor: "pointer", pointerEvents: "auto", boxShadow: "0 3px 14px rgba(0,0,0,.2)" });
      label.textContent = `${district.name} · …`;
      container.appendChild(label);
      labelNodes.set(district.name, label);
      label.addEventListener("click", () => showTooltip(district.name));
      label.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          showTooltip(district.name);
        }
      });
    });

    const maxBuildings = clusters.reduce((total, cluster) => total + cluster.placements.length, 0);
    const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
    const buildingMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.cream, roughness: 0.78 });
    const buildings = new THREE.InstancedMesh(buildingGeometry, buildingMaterial, maxBuildings);
    buildings.castShadow = true;
    buildings.receiveShadow = true;
    city.add(buildings);

    const roofGeometry = new THREE.BoxGeometry(1, 0.14, 1);
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.66, vertexColors: true });
    const roofs = new THREE.InstancedMesh(roofGeometry, roofMaterial, maxBuildings);
    roofs.castShadow = true;
    city.add(roofs);

    const windowsPerBuilding = 2;
    const windowCount = maxBuildings * windowsPerBuilding;
    const windowGeometry = new THREE.BoxGeometry(0.13, 0.12, 0.025);
    const windowMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.gold, emissive: PALETTE.gold, emissiveIntensity: 0.34, roughness: 0.45 });
    const windows = new THREE.InstancedMesh(windowGeometry, windowMaterial, windowCount);
    windows.castShadow = false;
    city.add(windows);

    function updateBuildings(time) {
      const dummy = new THREE.Object3D();
      const roofColor = new THREE.Color();
      let buildingId = 0;
      let windowId = 0;
      clusters.forEach((cluster) => {
        const score = cluster.currentScore;
        const scoreScale = Math.max(0.48, Math.min(1.48, score / 52.56));
        roofColor.set(scoreColor(score));
        const flashing = cluster.alertUntil > time;
        if (flashing) roofColor.lerp(new THREE.Color(PALETTE.low), 0.72 + Math.sin(time * 0.012) * 0.22);
        cluster.placements.forEach((building) => {
          const height = building.baseHeight * building.variation * scoreScale;
          dummy.position.set(building.x, height / 2, building.z);
          dummy.scale.set(building.width, height, building.depth);
          dummy.updateMatrix();
          buildings.setMatrixAt(buildingId, dummy.matrix);
          dummy.position.set(building.x, height + 0.07, building.z);
          dummy.scale.set(building.width + 0.1, 1, building.depth + 0.1);
          dummy.updateMatrix();
          roofs.setMatrixAt(buildingId, dummy.matrix);
          roofs.setColorAt(buildingId, roofColor);
          if (buildingId < windowCount / windowsPerBuilding) {
            const on = score > cluster.startScore + 0.08 || reducedMotion;
            for (let face = 0; face < windowsPerBuilding; face += 1) {
              const angle = face * Math.PI / 2;
              const offset = face % 2 === 0 ? building.width / 2 + 0.016 : building.depth / 2 + 0.016;
              dummy.position.set(building.x + Math.cos(angle) * offset, Math.min(height - 0.22, 0.45 + (face % 2) * 0.32), building.z + Math.sin(angle) * offset);
              dummy.rotation.set(0, -angle, 0);
              dummy.scale.set(1, 1, 1);
              if (!on) dummy.scale.set(0.01, 0.01, 0.01);
              dummy.updateMatrix();
              windows.setMatrixAt(windowId, dummy.matrix);
              windowId += 1;
            }
          }
          buildingId += 1;
        });
      });
      buildings.count = buildingId;
      roofs.count = buildingId;
      windows.count = windowId;
      buildings.instanceMatrix.needsUpdate = true;
      roofs.instanceMatrix.needsUpdate = true;
      windows.instanceMatrix.needsUpdate = true;
      if (roofs.instanceColor) roofs.instanceColor.needsUpdate = true;
    }

    function createBridge(x, z) {
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.38, 1.3), new THREE.MeshStandardMaterial({ color: PALETTE.cream, roughness: 0.72 }));
      bridge.position.set(x, 0.42, z);
      bridge.castShadow = true;
      city.add(bridge);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.12, 0.12), new THREE.MeshStandardMaterial({ color: PALETTE.gold, roughness: 0.5 }));
      [-0.52, 0.52].forEach((offset) => {
        const side = rail.clone();
        side.position.set(x, 0.7, z + offset);
        city.add(side);
      });
    }
    createBridge(-15, 4.1);
    createBridge(13, 5.6);

    const towerMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.cream, roughness: 0.48, metalness: 0.08 });
    const towerGroup = new THREE.Group();
    towerGroup.position.set(0, 0, -0.5);
    city.add(towerGroup);
    const towerLevels = [0.2, 1.3, 2.8, 4.4, 6.1, 7.5];
    const towerRadius = [0.2, 0.32, 0.48, 0.62, 0.76, 0.78];
    for (let index = 0; index < towerLevels.length - 1; index += 1) {
      const y1 = towerLevels[index];
      const y2 = towerLevels[index + 1];
      for (let spoke = 0; spoke < 8; spoke += 1) {
        const angle = spoke * Math.PI / 4;
        const nextAngle = angle + Math.PI / 4;
        const lowerA = new THREE.Vector3(Math.cos(angle) * towerRadius[index], y1, Math.sin(angle) * towerRadius[index]);
        const upperA = new THREE.Vector3(Math.cos(angle) * towerRadius[index + 1], y2, Math.sin(angle) * towerRadius[index + 1]);
        const upperB = new THREE.Vector3(Math.cos(nextAngle) * towerRadius[index + 1], y2, Math.sin(nextAngle) * towerRadius[index + 1]);
        addBeam(towerGroup, lowerA, upperA, 0.055, towerMaterial, THREE);
        addBeam(towerGroup, upperA, upperB, 0.045, towerMaterial, THREE);
      }
    }
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(2.25, 1), new THREE.MeshStandardMaterial({ color: PALETTE.gold, emissive: PALETTE.gold, emissiveIntensity: 0.72, roughness: 0.24, metalness: 0.24, flatShading: true }));
    ball.position.set(0, 9.7, -0.5);
    ball.castShadow = true;
    towerGroup.add(ball);
    const halo = new THREE.PointLight(0xffd98e, 2.6, 23, 2);
    halo.position.copy(ball.position);
    towerGroup.add(halo);

    function addBeam(parent, start, end, thickness, material, THREERef) {
      const direction = new THREERef.Vector3().subVectors(end, start);
      const beam = new THREERef.Mesh(new THREERef.CylinderGeometry(thickness, thickness, direction.length(), 5, 1), material);
      beam.position.copy(start).add(end).multiplyScalar(0.5);
      beam.quaternion.setFromUnitVectors(new THREERef.Vector3(0, 1, 0), direction.normalize());
      beam.castShadow = true;
      parent.add(beam);
    }

    const tooltip = document.createElement("div");
    tooltip.className = "city3d-tooltip";
    tooltip.hidden = true;
    Object.assign(tooltip.style, { position: "absolute", zIndex: "4", right: "14px", top: "14px", maxWidth: "min(310px, calc(100% - 28px))", maxHeight: "calc(100% - 28px)", overflow: "auto", boxSizing: "border-box", padding: "14px 16px", borderRadius: "14px", color: PALETTE.cream, background: "rgba(16,47,53,.96)", border: "1px solid rgba(212,185,120,.62)", boxShadow: "0 12px 35px rgba(0,0,0,.32)", font: "13px/1.5 system-ui,sans-serif", pointerEvents: "auto" });
    container.appendChild(tooltip);

    function showTooltip(name) {
      const record = districtRecords.get(name);
      if (!record) return;
      const score = record.score;
      const indicatorLines = Object.keys(INDICATORS).map((id) => `<div style="display:flex;justify-content:space-between;gap:12px"><span>${INDICATORS[id]}</span><b>${formatScore(record.indicators && record.indicators[id])}</b></div>`).join("");
      tooltip.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:8px"><strong style="font-size:16px">${escapeHtml(name)} · ${formatScore(score)}</strong><button type="button" aria-label="Закрыть" style="border:0;background:transparent;color:${PALETTE.gold};font-size:20px;cursor:pointer">×</button></div><div style="display:grid;gap:4px">${indicatorLines}</div>`;
      tooltip.hidden = false;
      const close = tooltip.querySelector("button");
      if (close) close.addEventListener("click", () => { tooltip.hidden = true; });
    }

    function setState(payload) {
      const rows = Array.isArray(payload.districts) ? payload.districts : [];
      const event = payload.event || null;
      rows.forEach((row) => {
        const cluster = clusters.find((item) => item.district === row.name);
        if (!cluster) return;
        const score = numeric(row.score_after, numeric(row.base_score, cluster.targetScore));
        cluster.fromScore = cluster.currentScore;
        cluster.startScore = cluster.currentScore;
        cluster.targetScore = score;
        cluster.transitionStart = performance.now();
        if (reducedMotion) cluster.currentScore = score;
        const indicatorValues = row.after || row.indicators || row.before || {};
        districtRecords.set(row.name, { score, indicators: indicatorValues });
      });
      if (event && event.district) {
        const cluster = clusters.find((item) => item.district === event.district);
        if (cluster) cluster.alertUntil = performance.now() + (reducedMotion ? 0 : 1800);
      }
      updateBuildings(performance.now());
      updateLabels(camera, city, renderer, container, labelNodes, clusters);
    }

    window.addEventListener("city3d:simulation", (event) => {
      if (event.detail) setState(event.detail);
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    renderer.domElement.addEventListener("click", (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(Array.from(districtMeshes.values()), false)[0];
      if (hit && hit.object.userData.districtName) showTooltip(hit.object.userData.districtName);
    });

    let animationFrame = 0;
    let lastFrame = 0;
    let angle = Math.atan2(camera.position.x, camera.position.z);
    const radius = Math.hypot(camera.position.x, camera.position.z);
    const resize = () => {
      if (!container.isConnected) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      updateLabels(camera, city, renderer, container, labelNodes, clusters);
    };
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    if (resizeObserver) resizeObserver.observe(container);
    window.addEventListener("resize", resize, { passive: true });

    function render(time) {
      animationFrame = 0;
      if (document.hidden || !container.isConnected) return;
      if (!lastFrame || time - lastFrame > 30) {
        lastFrame = time;
        if (!reducedMotion) angle += 0.00036 * (time - (render.previousTime || time));
        render.previousTime = time;
        if (!reducedMotion) camera.position.set(Math.sin(angle) * radius, 38, Math.cos(angle) * radius);
        camera.lookAt(0, 1.7, 3);
        if (!reducedMotion) {
          clusters.forEach((cluster) => {
            const progress = Math.min(1, (time - cluster.transitionStart) / 1500);
            const eased = progress * progress * (3 - 2 * progress);
            cluster.currentScore = cluster.fromScore + (cluster.targetScore - cluster.fromScore) * eased;
          });
          updateBuildings(time);
        }
        updateLabels(camera, city, renderer, container, labelNodes, clusters);
        renderer.render(scene, camera);
      }
      animationFrame = requestAnimationFrame(render);
    }

    function animate() {
      if (document.hidden) return;
      if (!animationFrame) animationFrame = requestAnimationFrame(render);
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (animationFrame) cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      } else animate();
    });

    function initData() {
      if (!previousFetch) return;
      previousFetch("/api/state").then((response) => response.json()).then((payload) => {
        const rows = Array.isArray(payload.districts) ? payload.districts : [];
        rows.forEach((row) => {
          const district = clusters.find((item) => item.district === row.name);
          if (!district) return;
          district.targetScore = numeric(row.base_score, 55);
          district.currentScore = district.targetScore;
          district.fromScore = district.targetScore;
          district.startScore = district.targetScore;
          districtRecords.set(row.name, { score: district.targetScore, indicators: row.indicators || row.after || {} });
        });
        updateBuildings(performance.now());
        updateLabels(camera, city, renderer, container, labelNodes, clusters);
      }).catch(() => {});
    }

    resize();
    initData();
    animate();
  }

  function updateLabels(camera, city, renderer, container, labels, clusters) {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    clusters.forEach((cluster) => {
      const label = labels.get(cluster.district);
      if (!label) return;
      label.textContent = `${cluster.district} · ${formatScore(cluster.currentScore)}`;
      label.style.borderColor = scoreColor(cluster.currentScore);
      const point = new window.THREE.Vector3(
        DISTRICTS.find((district) => district.name === cluster.district).x,
        10,
        DISTRICTS.find((district) => district.name === cluster.district).z
      );
      point.project(camera);
      const x = (point.x * 0.5 + 0.5) * width;
      const y = (-point.y * 0.5 + 0.5) * height;
      label.style.left = `${x}px`;
      label.style.top = `${y}px`;
      label.style.display = point.z > 1 ? "none" : "block";
    });
  }

  function numeric(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  function formatScore(value) {
    return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2).replace(".", ",") : "—";
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }

  install();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", waitForContainer, { once: true });
  else waitForContainer();
})();

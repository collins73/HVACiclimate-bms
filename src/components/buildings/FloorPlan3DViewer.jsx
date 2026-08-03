import { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Box, Layers, Maximize2, RotateCcw, Sun, Moon, Cpu, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Zone type color palette (vivid, distinct)
const ZONE_COLORS = {
  'Office':            '#3b82f6',
  'Lobby':             '#22d3ee',
  'Server Room':       '#ef4444',
  'Conference Room':   '#a855f7',
  'Warehouse':         '#f59e0b',
  'Retail':            '#ec4899',
  'Residential':       '#10b981',
  'Other':             '#64748b',
};

const colorFor = (type) => ZONE_COLORS[type] || ZONE_COLORS.Other;

// Simple shelf-based rectangle packing: places zones left-to-right, wrapping when row fills.
function packZones(zones, totalWidth = 50) {
  const rowHeight = 12;
  let x = 1, y = 1, rowMaxH = 0;
  const placed = [];
  zones.forEach((z, i) => {
    const sqft = z.sqft || 400;
    // scale: 1 sqft ~ 0.05 sq units, clamp
    const area = Math.max(4, Math.min(120, sqft * 0.05));
    // aspect: vary by index to avoid uniform squares
    const aspect = 1 + ((i % 3) * 0.25);
    let w = Math.sqrt(area * aspect);
    let h = Math.sqrt(area / aspect);
    if (x + w > totalWidth - 1) {
      x = 1;
      y += rowMaxH + 1;
      rowMaxH = 0;
    }
    placed.push({ ...z, x, y, w, h });
    x += w + 1;
    if (h > rowMaxH) rowMaxH = h;
  });
  return { placed, totalHeight: y + rowMaxH + 1 };
}

export default function FloorPlan3DViewer({ building, zones = [], blueprints = [], sensorPins = [] }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const labelsRef = useRef([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [hd, setHd] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [activeFloor, setActiveFloor] = useState(1);

  const floors = useMemo(() => {
    const set = new Set(zones.map(z => z.floor || 1));
    return Array.from(set).sort((a, b) => a - b);
  }, [zones]);

  const layout = useMemo(() => {
    const floorZones = zones.filter(z => (z.floor || 1) === activeFloor);
    return packZones(floorZones);
  }, [zones, activeFloor]);

  // Initialize scene once
  useEffect(() => {
    let mounted = true;
    try {
      const mount = mountRef.current;
      const width = mount.clientWidth;
      const height = mount.clientHeight || 520;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#0a0e1a');
      scene.fog = new THREE.Fog('#0a0e1a', 80, 200);

      const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 500);
      camera.position.set(45, 38, 55);
      camera.lookAt(0, 0, 0);

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
        stencil: false,
      });
      renderer.setPixelRatio(hd ? Math.min(window.devicePixelRatio, 2) : 1);
      renderer.setSize(width, height);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      mount.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 15;
      controls.maxDistance = 140;
      controls.maxPolarAngle = Math.PI / 2.05;
      controls.target.set(0, 0, 0);

      // Lighting
      const ambient = new THREE.AmbientLight(0x6080a0, 0.6);
      scene.add(ambient);

      const hemi = new THREE.HemisphereLight(0x88aaff, 0x223344, 0.5);
      scene.add(hemi);

      const sun = new THREE.DirectionalLight(0xffffff, 1.4);
      sun.position.set(40, 60, 30);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 200;
      sun.shadow.camera.left = -60;
      sun.shadow.camera.right = 60;
      sun.shadow.camera.top = 60;
      sun.shadow.camera.bottom = -60;
      sun.shadow.bias = -0.0005;
      scene.add(sun);

      // Ground grid
      const groundGeo = new THREE.PlaneGeometry(200, 200);
      const groundMat = new THREE.MeshStandardMaterial({
        color: 0x0d1320,
        roughness: 0.95,
        metalness: 0.0,
      });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.05;
      ground.receiveShadow = true;
      scene.add(ground);

      const grid = new THREE.GridHelper(200, 80, 0x1e293b, 0x141d2e);
      grid.position.y = 0;
      scene.add(grid);

      sceneRef.current = scene;
      rendererRef.current = renderer;
      cameraRef.current = camera;
      controlsRef.current = controls;

      const animate = () => {
        if (!mounted) return;
        requestAnimationFrame(animate);
        controls.update();
        // Billboard labels
        labelsRef.current.forEach(({ sprite, mesh }) => {
          if (sprite.visible) sprite.lookAt(camera.position);
        });
        renderer.render(scene, camera);
      };
      animate();

      const onResize = () => {
        const w = mount.clientWidth;
        const h = mount.clientHeight || 520;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', onResize);

      setReady(true);

      return () => {
        mounted = false;
        window.removeEventListener('resize', onResize);
        controls.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
        scene.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose?.();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose?.());
            else obj.material.dispose?.();
          }
        });
      };
    } catch (e) {
      console.error('3D init failed', e);
      setError(e.message || 'Failed to initialize 3D viewer');
    }
  }, []);

  // Rebuild floor plan when layout/floor changes
  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;

    // Remove previous floor group
    const existing = scene.getObjectByName('floor-group');
    if (existing) scene.remove(existing);

    const group = new THREE.Group();
    group.name = 'floor-group';

    const { placed, totalHeight } = layout;
    if (placed.length === 0) {
      sceneRef.current.add(group);
      return;
    }

    const totalWidth = 50;
    // Center offset
    const offsetX = -totalWidth / 2;
    const offsetZ = -totalHeight / 2;

    // Floor slab
    const slabGeo = new THREE.BoxGeometry(totalWidth + 2, 0.4, totalHeight + 2);
    const slabMat = new THREE.MeshStandardMaterial({
      color: 0x1a2438,
      roughness: 0.85,
      metalness: 0.05,
    });
    const slab = new THREE.Mesh(slabGeo, slabMat);
    slab.position.set(0, -0.2, 0);
    slab.receiveShadow = true;
    group.add(slab);

    // Floor plan image texture (if available)
    const bpImage = blueprints.find(bp => bp.floor === activeFloor) || blueprints[0];
    if (bpImage && /\.(png|jpg|jpeg|gif|webp)(\?|$)/i.test(bpImage.url || '')) {
      const loader = new THREE.TextureLoader();
      loader.crossOrigin = 'anonymous';
      loader.load(
        bpImage.url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = rendererRef.current?.capabilities.getMaxAnisotropy() || 1;
          const planeGeo = new THREE.PlaneGeometry(totalWidth, totalHeight);
          const planeMat = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            opacity: 0.55,
          });
          const plane = new THREE.Mesh(planeGeo, planeMat);
          plane.rotation.x = -Math.PI / 2;
          plane.position.set(0, 0.02, 0);
          group.add(plane);
        },
        undefined,
        () => { /* ignore load errors */ }
      );
    }

    // Build zones
    const wallHeight = 3.2;
    const wallThickness = 0.25;
    labelsRef.current = [];

    placed.forEach((z) => {
      const cx = z.x + z.w / 2 + offsetX;
      const cz = z.y + z.h / 2 + offsetZ;
      const color = new THREE.Color(colorFor(z.zone_type));

      // Zone floor
      const floorGeo = new THREE.BoxGeometry(z.w, 0.1, z.h);
      const floorMat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.6,
        metalness: 0.1,
        transparent: true,
        opacity: 0.85,
        emissive: color,
        emissiveIntensity: 0.08,
      });
      const floorMesh = new THREE.Mesh(floorGeo, floorMat);
      floorMesh.position.set(cx, 0.05, cz);
      floorMesh.receiveShadow = true;
      group.add(floorMesh);

      // Walls (4 sides)
      const wallMat = new THREE.MeshStandardMaterial({
        color: 0x4a5a78,
        roughness: 0.7,
        metalness: 0.15,
      });
      const addWall = (w, h, d, px, pz) => {
        const g = new THREE.BoxGeometry(w, h, d);
        const m = new THREE.Mesh(g, wallMat);
        m.position.set(px, h / 2, pz);
        m.castShadow = true;
        m.receiveShadow = true;
        group.add(m);
      };
      addWall(z.w + wallThickness, wallHeight, wallThickness, cx, cz - z.h / 2); // back
      addWall(z.w + wallThickness, wallHeight, wallThickness, cx, cz + z.h / 2); // front
      addWall(wallThickness, wallHeight, z.h, cx - z.w / 2, cz); // left
      addWall(wallThickness, wallHeight, z.h, cx + z.w / 2, cz); // right

      // Door gap (subtract a small section visually by adding a darker box on top of floor at one wall)
      const doorGeo = new THREE.BoxGeometry(1.4, wallHeight * 0.85, wallThickness * 1.1);
      const doorMat = new THREE.MeshStandardMaterial({
        color: 0x1a2438,
        roughness: 0.9,
        transparent: true,
        opacity: 0.0,
      });
      const door = new THREE.Mesh(doorGeo, doorMat);
      door.position.set(cx + z.w / 4, wallHeight * 0.425, cz + z.h / 2);
      group.add(door);

      // Zone label sprite
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 160;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(10, 14, 26, 0.85)';
      ctx.roundRect = ctx.roundRect || function (x, y, w, h, r) {
        this.beginPath();
        this.moveTo(x + r, y);
        this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r);
        this.arcTo(x, y, x + w, y, r);
        this.closePath();
      };
      ctx.roundRect(8, 8, 496, 144, 18);
      ctx.fill();
      ctx.strokeStyle = color.getStyle();
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 56px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(z.name?.slice(0, 22) || 'Zone', 256, 70);
      ctx.fillStyle = color.getStyle();
      ctx.font = '500 32px Inter, sans-serif';
      ctx.fillText(`${z.zone_type || 'Zone'} · ${z.sqft || 0} sqft`, 256, 120);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(8, 2.5, 1);
      sprite.position.set(cx, wallHeight + 1.5, cz);
      sprite.visible = showLabels;
      group.add(sprite);
      labelsRef.current.push({ sprite, mesh: floorMesh });
    });

    // Sensor pins on this floor
    const floorPins = sensorPins.filter(p => {
      const zone = zones.find(z => z.id === p.zone_id);
      return zone && (zone.floor || 1) === activeFloor;
    });
    floorPins.forEach((pin) => {
      const px = (pin.x_pct / 100) * totalWidth + offsetX;
      const pz = (pin.y_pct / 100) * totalHeight + offsetZ;
      // Pin: cylinder + glowing sphere
      const pinGeo = new THREE.CylinderGeometry(0.18, 0.18, 2.2, 16);
      const pinMat = new THREE.MeshStandardMaterial({
        color: 0x06b6d4,
        emissive: 0x06b6d4,
        emissiveIntensity: 0.6,
        metalness: 0.4,
        roughness: 0.3,
      });
      const pinMesh = new THREE.Mesh(pinGeo, pinMat);
      pinMesh.position.set(px, 1.1, pz);
      pinMesh.castShadow = true;
      group.add(pinMesh);

      const ballGeo = new THREE.SphereGeometry(0.35, 24, 24);
      const ballMat = new THREE.MeshStandardMaterial({
        color: 0x67e8f9,
        emissive: 0x06b6d4,
        emissiveIntensity: 1.2,
        metalness: 0.2,
        roughness: 0.2,
      });
      const ball = new THREE.Mesh(ballGeo, ballMat);
      ball.position.set(px, 2.4, pz);
      group.add(ball);

      // Light point glow
      const glow = new THREE.PointLight(0x06b6d4, 0.6, 6);
      glow.position.set(px, 2.4, pz);
      group.add(glow);
    });

    // Building roof outline (subtle frame)
    const frameMat = new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.4 });
    const frameGeo = new THREE.BufferGeometry();
    const fy = wallHeight;
    const fx1 = offsetX, fx2 = offsetX + totalWidth;
    const fz1 = offsetZ, fz2 = offsetZ + totalHeight;
    frameGeo.setFromPoints([
      new THREE.Vector3(fx1, fy, fz1), new THREE.Vector3(fx2, fy, fz1),
      new THREE.Vector3(fx2, fy, fz1), new THREE.Vector3(fx2, fy, fz2),
      new THREE.Vector3(fx2, fy, fz2), new THREE.Vector3(fx1, fy, fz2),
      new THREE.Vector3(fx1, fy, fz2), new THREE.Vector3(fx1, fy, fz1),
    ]);
    const frame = new THREE.LineSegments(frameGeo, frameMat);
    group.add(frame);

    scene.add(group);

    // Frame camera to scene
    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  }, [layout, activeFloor, blueprints, sensorPins, zones, showLabels]);

  // HD toggle
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setPixelRatio(hd ? Math.min(window.devicePixelRatio, 2) : 1);
    }
  }, [hd]);

  // Auto-rotate
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
      controlsRef.current.autoRotateSpeed = 0.8;
    }
  }, [autoRotate]);

  // Labels visibility
  useEffect(() => {
    labelsRef.current.forEach(({ sprite }) => { sprite.visible = showLabels; });
  }, [showLabels]);

  const resetCamera = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(45, 38, 55);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  };

  const fullscreen = () => {
    if (mountRef.current?.requestFullscreen) {
      mountRef.current.requestFullscreen();
    }
  };

  if (error) {
    return (
      <div className="bg-card border border-destructive/30 rounded-xl p-8 text-center">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 text-destructive" />
        <p className="text-sm text-foreground font-medium">3D viewer failed to load</p>
        <p className="text-xs text-muted-foreground mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Box className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">3D Floor Plan Model</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">· HD render with zone geometry & sensor pins</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {floors.length > 1 && (
            <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
              {floors.map(f => (
                <button
                  key={f}
                  onClick={() => setActiveFloor(f)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    activeFloor === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Floor {f}
                </button>
              ))}
            </div>
          )}
          <Button size="sm" variant="outline" onClick={() => setHd(h => !h)} className="h-8 gap-1.5 border-border">
            {hd ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5" />}
            {hd ? 'HD' : 'SD'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowLabels(s => !s)} className="h-8 gap-1.5 border-border">
            <Layers className="w-3.5 h-3.5" />
            Labels
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAutoRotate(r => !r)} className="h-8 gap-1.5 border-border">
            <RotateCcw className={`w-3.5 h-3.5 ${autoRotate ? 'text-primary animate-spin-slow' : ''}`} style={{ animationDuration: '3s' }} />
            Rotate
          </Button>
          <Button size="sm" variant="outline" onClick={resetCamera} className="h-8 gap-1.5 border-border">
            <Cpu className="w-3.5 h-3.5" />
            Reset
          </Button>
          <Button size="sm" variant="outline" onClick={fullscreen} className="h-8 gap-1.5 border-border">
            <Maximize2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div
        ref={mountRef}
        className="w-full h-[520px] sm:h-[600px] rounded-xl border border-border bg-[#0a0e1a] overflow-hidden relative"
      >
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Initializing 3D engine…
            </div>
          </div>
        )}
        {ready && layout.placed.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm pointer-events-none">
            <div className="text-center">
              <Box className="w-10 h-10 mx-auto mb-2 opacity-30" />
              No zones on this floor
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Legend:</span>
        {Object.entries(ZONE_COLORS).slice(0, 6).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: v }} />
            {k}
          </span>
        ))}
        <span className="flex items-center gap-1.5 ml-auto">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
          Sensor Pin
        </span>
        <span className="hidden sm:inline">· Drag to rotate · Scroll to zoom · Right-click to pan</span>
      </div>
    </div>
  );
}
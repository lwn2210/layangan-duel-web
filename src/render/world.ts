import * as THREE from 'three'
import { HANDS, PLANE_Z } from '../sim/layout'
import { canvasTexture, speckle } from './textures'

// Late afternoon over a kampung field: sky, houses, trees, a mosque on the
// horizon and the two kids holding the lines. Pure decoration; nothing here
// touches the sim.

const std = (params: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.9, ...params })

// Deterministic scatter so every client sees the same kampung.
let seed = 12345
function rand(): number {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
}

function skyDome(sunDir: THREE.Vector3): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#3a74bd') },
      mid: { value: new THREE.Color('#9cc3e3') },
      horizon: { value: new THREE.Color('#fbd3a0') },
      sunDir: { value: sunDir },
    },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.18, h));
        c = mix(c, top, smoothstep(0.18, 0.7, h));
        float sun = max(dot(vDir, sunDir), 0.0);
        c += vec3(1.0, 0.72, 0.38) * (pow(sun, 8.0) * 0.35 + pow(sun, 400.0) * 1.5);
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
  return new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), material)
}

function grassTexture(): THREE.Texture {
  const tex = canvasTexture('rumput', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#7fae4a'
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(${150 + rand() * 40}, ${130 + rand() * 30}, 80, 0.18)`
      ctx.beginPath()
      ctx.ellipse(rand() * w, rand() * h, 10 + rand() * 30, 6 + rand() * 18, rand() * 3, 0, Math.PI * 2)
      ctx.fill()
    }
    speckle(ctx, w, h, 3000, 0.12)
  })
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(60, 60)
  return tex
}

function house(): THREE.Group {
  const g = new THREE.Group()
  const walls = ['#f2e6cc', '#e3ecdf', '#f6d5b0', '#ece3f1', '#f7f1e3']
  const w = 6 + rand() * 4
  const d = 5 + rand() * 3
  const h = 3 + rand() * 0.8
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std({ color: walls[Math.floor(rand() * walls.length)] }))
  body.position.y = h / 2
  // Gable roof: a three-sided prism lying along x, apex up.
  const roofGeo = new THREE.CylinderGeometry(1, 1, w + 0.6, 3, 1)
  roofGeo.rotateX(Math.PI / 2)
  roofGeo.rotateY(Math.PI / 2)
  const roof = new THREE.Mesh(roofGeo, std({ color: rand() < 0.75 ? '#b4532d' : '#8a8f96' }))
  roof.scale.set(1, 1.5, (d / 2 + 0.5) / 0.866)
  roof.position.y = h + 0.75
  g.add(body, roof)
  return g
}

function coconut(): THREE.Group {
  const g = new THREE.Group()
  const height = 9 + rand() * 6
  const lean = (rand() - 0.5) * 0.3
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, height, 7), std({ color: '#8a6d4b' }))
  trunk.position.y = height / 2
  trunk.rotation.z = lean
  g.add(trunk)
  const top = new THREE.Vector3(-Math.sin(lean) * height, height, 0)
  const leaf = std({ color: '#3d7f2c', side: THREE.DoubleSide })
  for (let i = 0; i < 9; i++) {
    const frond = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 4.6), leaf)
    frond.position.copy(top)
    frond.rotation.set(-1.05 - rand() * 0.4, (i / 9) * Math.PI * 2, 0, 'YXZ')
    frond.translateY(2)
    g.add(frond)
  }
  return g
}

function canopyTree(): THREE.Group {
  const g = new THREE.Group()
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 4, 6), std({ color: '#6e5338' }))
  trunk.position.y = 2
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(3.5 + rand() * 2, 1), std({ color: rand() < 0.5 ? '#4b8a34' : '#3f7a2e', flatShading: true }))
  crown.position.y = 6.5
  crown.scale.y = 0.8
  g.add(trunk, crown)
  return g
}

function mosque(): THREE.Group {
  const g = new THREE.Group()
  const base = new THREE.Mesh(new THREE.BoxGeometry(22, 9, 18), std({ color: '#f3efe4' }))
  base.position.y = 4.5
  const dome = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), std({ color: '#2f8f6a', roughness: 0.5 }))
  dome.position.y = 9
  const finial = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3, 8), std({ color: '#d9b44a', metalness: 0.6 }))
  finial.position.y = 17.5
  const minaret = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 28, 10), std({ color: '#f3efe4' }))
  minaret.position.set(16, 14, 0)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), dome.material)
  cap.position.set(16, 28, 0)
  g.add(base, dome, finial, minaret, cap)
  return g
}

function kid(shirt: string, at: THREE.Vector3, hand: THREE.Vector3): THREE.Group {
  const g = new THREE.Group()
  g.position.copy(at)
  const skin = std({ color: '#b07a52' })
  const shorts = std({ color: '#2d3a4a' })
  const shirtMat = std({ color: shirt })
  for (const x of [-0.12, 0.12]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 6), skin)
    leg.position.set(x, 0.3, 0)
    g.add(leg)
  }
  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.25, 8), shorts)
  hips.position.y = 0.68
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.35, 4, 8), shirtMat)
  torso.position.y = 1.0
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin)
  head.position.y = 1.42
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), std({ color: '#1b1410' }))
  hair.position.y = 1.44
  g.add(hips, torso, head, hair)
  // Both arms reach up toward the hand point the line starts from.
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Vector3(side * 0.22, 1.18, 0)
    const local = hand.clone().sub(g.position)
    const dir = local.sub(shoulder)
    const len = dir.length()
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 6), skin)
    arm.position.copy(shoulder).addScaledVector(dir, 0.5)
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
    g.add(arm)
  }
  return g
}

function cloudTexture(): THREE.Texture {
  return canvasTexture('awan', 256, 128, (ctx, w, h) => {
    for (let i = 0; i < 14; i++) {
      const x = w * (0.2 + rand() * 0.6)
      const y = h * (0.45 + rand() * 0.25)
      const r = 20 + rand() * 34
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
      grad.addColorStop(0, 'rgba(255, 248, 238, 0.9)')
      grad.addColorStop(1, 'rgba(255, 248, 238, 0)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
    }
  })
}

export class World {
  private readonly clouds: THREE.Sprite[] = []

  constructor(scene: THREE.Scene) {
    const sunDir = new THREE.Vector3(-0.55, 0.22, -1).normalize()
    scene.add(skyDome(sunDir))
    scene.fog = new THREE.Fog('#f3d6b0', 160, 1100)
    scene.add(new THREE.HemisphereLight('#cfe2ff', '#6f8a45', 1.2))
    // The visible sun sits ahead; the key light comes from behind the camera so the kites read.
    const key = new THREE.DirectionalLight('#ffe2bd', 2.2)
    key.position.set(-30, 60, 60)
    scene.add(key)

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), std({ map: grassTexture() }))
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)

    const place = (obj: THREE.Object3D, x: number, z: number, yaw = rand() * Math.PI) => {
      obj.position.set(x, 0, z)
      obj.rotation.y = yaw
      scene.add(obj)
    }
    // Rows of houses behind the kites' plane and down both sides of the field.
    for (let i = 0; i < 70; i++) {
      const z = PLANE_Z - 8 - rand() * 160
      const x = (rand() - 0.5) * 320
      place(house(), x, z, (rand() - 0.5) * 0.5)
    }
    for (let i = 0; i < 24; i++) {
      const side = i % 2 ? 1 : -1
      place(house(), side * (34 + rand() * 50), -10 - rand() * 60, Math.PI / 2 + (rand() - 0.5) * 0.4)
    }
    for (let i = 0; i < 45; i++) place(coconut(), (rand() - 0.5) * 300, PLANE_Z - rand() * 200)
    for (let i = 0; i < 30; i++) place(canopyTree(), (rand() - 0.5) * 340, PLANE_Z - 20 - rand() * 220)
    for (let i = 0; i < 10; i++) place(coconut(), (i % 2 ? 1 : -1) * (26 + rand() * 30), -5 - rand() * 50)
    place(mosque(), 40, -330, 0.2)

    const hills = std({ color: '#8ba7c2', flatShading: true })
    for (let i = 0; i < 12; i++) {
      const h = 90 + rand() * 140
      const m = new THREE.Mesh(new THREE.ConeGeometry(180 + rand() * 160, h, 7), hills)
      m.position.set(-900 + i * 160 + rand() * 60, h / 2 - 10, -1000 - rand() * 200)
      scene.add(m)
    }

    const cloudMat = new THREE.SpriteMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, fog: false })
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Sprite(cloudMat)
      c.scale.set(160 + rand() * 120, 60 + rand() * 40, 1)
      c.position.set((rand() - 0.5) * 1400, 120 + rand() * 160, -700 - rand() * 300)
      scene.add(c)
      this.clouds.push(c)
    }

    // Each kid stands just behind and inside their hand point, holding the line up.
    HANDS.forEach((hand, i) => {
      const at = new THREE.Vector3(hand.x + (i === 0 ? 0.1 : -0.1), 0, hand.z + 0.35)
      scene.add(kid(i === 0 ? '#d63b2f' : '#2e6fd0', at, new THREE.Vector3(hand.x, hand.y, hand.z)))
    })
  }

  update(dt: number): void {
    for (const c of this.clouds) {
      c.position.x += dt * 2
      if (c.position.x > 800) c.position.x -= 1600
    }
  }
}

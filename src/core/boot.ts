import * as THREE from 'three';

/** Temporary scene shown until the integration pass wires world + physics + gameplay. */
export function bootPlaceholder(host: HTMLElement): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87c5f0);
  const camera = new THREE.PerspectiveCamera(60, host.clientWidth / host.clientHeight, 0.1, 500);
  camera.position.set(0, 3, 6);
  camera.lookAt(0, 0.5, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x557744, 1.2));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(20, 48), new THREE.MeshStandardMaterial({ color: 0x6fbf4a }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const goat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.6), new THREE.MeshStandardMaterial({ color: 0xf2efe6 }));
  goat.position.y = 0.9;
  scene.add(goat);

  window.addEventListener('resize', () => {
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight);
  });
  renderer.setAnimationLoop((t) => {
    goat.rotation.y = t / 1000;
    goat.position.y = 0.9 + Math.abs(Math.sin(t / 300)) * 0.4;
    renderer.render(scene, camera);
  });
}

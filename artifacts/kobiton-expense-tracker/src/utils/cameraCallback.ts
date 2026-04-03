type CameraResultCallback = (uri: string, fileName: string) => void;

let pending: CameraResultCallback | null = null;

export function setCameraCallback(cb: CameraResultCallback) {
  pending = cb;
}

export function callCameraCallback(uri: string, fileName: string) {
  if (pending) {
    pending(uri, fileName);
    pending = null;
  }
}

export function clearCameraCallback() {
  pending = null;
}

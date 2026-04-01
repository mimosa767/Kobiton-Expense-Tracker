let _message: string | null = null;
let _type: 'success' | 'error' = 'success';

export function setPendingToast(message: string, type: 'success' | 'error' = 'success') {
  _message = message;
  _type = type;
}

export function takePendingToast(): { message: string; type: 'success' | 'error' } | null {
  if (!_message) return null;
  const result = { message: _message, type: _type };
  _message = null;
  _type = 'success';
  return result;
}

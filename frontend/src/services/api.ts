export async function request(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = { 
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string>) 
  };
  
  // 只在有 body 且不是 FormData 时才设置 Content-Type
  if (options.body && !headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401 && !url.endsWith('/api/login')) {
    localStorage.removeItem('auth_token');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    let errorData;
    try {
      errorData = await response.json();
    } catch (e) {
      errorData = { error: 'Request failed' };
    }
    const error = new Error(errorData.error || 'Request failed');
    (error as any).response = { data: errorData };
    throw error;
  }
  return response.json();
}

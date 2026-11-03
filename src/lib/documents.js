async function readError(response) {
  const data = await response.json().catch(() => null);
  return Object.assign(new Error(data?.error || `Request failed (${response.status})`), { status: response.status });
}

export async function fetchDocumentCatalog(academicYearId = '') {
  const query = academicYearId ? `?academic_year_id=${encodeURIComponent(academicYearId)}` : '';
  const response = await fetch(`/api/documents/catalog${query}`, { credentials: 'same-origin' });
  if (!response.ok) throw await readError(response);
  return response.json();
}

function pdfUrl(params, disposition) {
  const query = new URLSearchParams({ ...params, disposition });
  for (const [key, value] of [...query]) if (!value) query.delete(key);
  return `/api/documents/pdf?${query}`;
}

export async function fetchPdfBlob(params, disposition = 'inline') {
  const response = await fetch(pdfUrl(params, disposition), { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw await readError(response);
  return response.blob();
}

export async function fetchZipBlob(body) {
  const response = await fetch('/api/documents/zip', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readError(response);
  return response.blob();
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function downloadPdf(params, filename) {
  saveBlob(await fetchPdfBlob(params, 'attachment'), filename);
}

export async function printPdf(params) {
  const blob = await fetchPdfBlob(params, 'inline');
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.src = url;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60000);
  };
  document.body.appendChild(frame);
}

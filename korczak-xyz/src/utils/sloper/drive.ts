/*
 * "Upload to Google Drive", the one integration sloper had that is not a generation API.
 *
 * It is a second, unrelated Google sign-in — nothing to do with the korczak.xyz account, which is
 * Firebase Auth. Google Identity Services is loaded on demand, asks for `drive.file` only (the
 * scope that grants access to files this app itself created, not to the drive), and hands back an
 * access token that lives in memory for the hour it is valid and is never stored anywhere.
 *
 * The upload is resumable rather than a single PUT because the video is tens of megabytes over
 * whatever connection the page happens to be on, and a resumable session is the only shape that
 * can report progress. `webViewLink` takes a second request: a resumable upload's final response
 * carries the file id and nothing else.
 *
 * The button disappears entirely when `PUBLIC_GOOGLE_DRIVE_CLIENT_ID` is unset, which is how it
 * behaves on any deploy that has not configured an OAuth client. Downloading still works.
 */

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
/** Must be a multiple of 256 KiB — Drive rejects a mid-session chunk that is not. */
const CHUNK_SIZE = 2 * 1024 * 1024;

export interface DriveUploadResult {
  fileId: string;
  webViewLink: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}

interface GisGlobal {
  accounts?: {
    oauth2?: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type: string; message?: string }) => void;
      }) => TokenClient;
    };
  };
}

function gis(): GisGlobal | undefined {
  return (globalThis as { google?: GisGlobal }).google;
}

export function driveClientId(): string | undefined {
  const id = import.meta.env.PUBLIC_GOOGLE_DRIVE_CLIENT_ID as string | undefined;
  return id && id.trim() ? id.trim() : undefined;
}

let gisPromise: Promise<void> | null = null;

export function loadGisScript(): Promise<void> {
  if (gisPromise) return gisPromise;

  gisPromise = new Promise<void>((resolve, reject) => {
    if (gis()?.accounts?.oauth2) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Cleared so a later attempt can retry — a blocked script is often a one-off.
      gisPromise = null;
      reject(new Error('Could not load Google Identity Services'));
    };
    document.head.appendChild(script);
  });

  return gisPromise;
}

export function requestAccessToken(clientId: string): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    const oauth2 = gis()?.accounts?.oauth2;
    if (!oauth2) {
      reject(new Error('Google Identity Services is not loaded'));
      return;
    }

    oauth2
      .initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (response) => {
          if (response.error) reject(new Error(response.error_description ?? response.error));
          else resolve(response);
        },
        error_callback: (error) => reject(new Error(error.message ?? 'Google sign-in was cancelled')),
      })
      .requestAccessToken();
  });
}

export async function uploadToDrive(
  accessToken: string,
  file: Blob,
  filename: string,
  onProgress?: (fraction: number) => void,
): Promise<DriveUploadResult> {
  const initResponse = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=resumable`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(file.size),
    },
    body: JSON.stringify({ name: filename, mimeType: 'video/mp4' }),
  });

  if (!initResponse.ok) {
    throw new Error(`Drive refused the upload: ${initResponse.status} ${await initResponse.text()}`);
  }

  const sessionUri = initResponse.headers.get('Location');
  if (!sessionUri) throw new Error('Drive returned no upload session');

  let offset = 0;
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);

    const putResponse = await fetch(sessionUri, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${file.size}` },
      body: file.slice(offset, end),
    });

    // 308 means "keep going"; 200/201 means the last chunk landed and the file exists.
    if (putResponse.status === 200 || putResponse.status === 201) {
      onProgress?.(1);
      const { id } = await putResponse.json();
      return { fileId: id, webViewLink: await webViewLink(accessToken, id) };
    }

    if (putResponse.status !== 308) {
      throw new Error(
        `Upload failed at byte ${offset}: ${putResponse.status} ${await putResponse.text()}`,
      );
    }

    offset = end;
    onProgress?.(offset / file.size);
  }

  throw new Error('The upload ended without Drive confirming the file');
}

async function webViewLink(accessToken: string, fileId: string): Promise<string> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) return `https://drive.google.com/file/d/${fileId}/view`;
  const data = await response.json();
  return data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
}

/** The filename both the download and the Drive copy use, so they match. */
export function videoFilename(): string {
  return `slop-video-${new Date().toISOString().split('T')[0]}.mp4`;
}

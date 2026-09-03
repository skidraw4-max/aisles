export const GALLERY_UPLOAD_PATH = '/upload?category=GALLERY';
export const GALLERY_UPLOAD_LOGIN_PATH = `/login?next=${encodeURIComponent(GALLERY_UPLOAD_PATH)}`;

/** Logged-in users go to upload; guests go through login with return path. */
export function galleryUploadHref(isLoggedIn: boolean): string {
  return isLoggedIn ? GALLERY_UPLOAD_PATH : GALLERY_UPLOAD_LOGIN_PATH;
}

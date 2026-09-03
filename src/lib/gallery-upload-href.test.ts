import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GALLERY_UPLOAD_LOGIN_PATH,
  GALLERY_UPLOAD_PATH,
  galleryUploadHref,
} from './gallery-upload-href';

describe('galleryUploadHref', () => {
  it('sends guests through login with upload return path', () => {
    assert.equal(galleryUploadHref(false), GALLERY_UPLOAD_LOGIN_PATH);
    assert.match(galleryUploadHref(false), /^\/login\?next=/);
  });

  it('sends logged-in users straight to gallery upload', () => {
    assert.equal(galleryUploadHref(true), GALLERY_UPLOAD_PATH);
    assert.doesNotMatch(galleryUploadHref(true), /\/login/);
  });
});

'use strict';

const { MpvPlayer: NativeMpvPlayer } = require('../build/Release/mpv_addon.node');
const { EventEmitter } = require('events');

/**
 * MpvPlayer
 * Events:
 *   'frame' (buffer: Buffer, width: number, height: number)  -- one frame of RGBA8 pixel data
 *   'event' ({ event: string, name?: string, value?: string }) -- passthrough of mpv events
 */
class MpvPlayer extends EventEmitter {
  constructor() {
    super();
    this._native = new NativeMpvPlayer();
    this._initialized = false;
  }

  init(width, height) {
    if (this._initialized) throw new Error('already initialized');
    this._native.init(
      width,
      height,
      (buffer, w, h) => this.emit('frame', buffer, w, h),
      (evt) => this.emit('event', evt)
    );
    this._initialized = true;
  }

  loadFile(path) {
    this._native.command(['loadfile', path]);
  }

  command(args) {
    this._native.command(args);
  }

  setProperty(name, value) {
    this._native.setProperty(name, String(value));
  }

  getProperty(name) {
    return this._native.getProperty(name);
  }

  observeProperty(name) {
    this._native.observeProperty(name);
  }

  play() {
    this.setProperty('pause', 'no');
  }

  pause() {
    this.setProperty('pause', 'yes');
  }

  seek(seconds, mode = 'absolute') {
    this._native.command(['seek', String(seconds), mode]);
  }

  resize(width, height) {
    this._native.resize(width, height);
  }

  destroy() {
    this._native.destroy();
    this._initialized = false;
  }
}

module.exports = { MpvPlayer };

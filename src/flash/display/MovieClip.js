/* -*- Mode: js; js-indent-level: 2; indent-tabs-mode: nil; tab-width: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/*
 * Copyright 2013 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/*global MP3DecoderSession, avm1lib, construct, $DEBUG */

var MovieClipDefinition = (function () {
  var def = {
    __class__: 'flash.display.MovieClip',
    initialize: function () {
      this._playHead = 1;
      this._currentFrame = 1;
      this._currentFrameLabel = null;
      this._currentLabel = null;
      this._currentScene = 0;
      this._enabled = true;
      this._frameScripts = { };
      this._framesLoaded = 1;
      this._isPlaying = false;
      this._labelMap = { };
      this._sceneFrameMap = { };
      this._sceneMap = { };
      this._scenes = [];
      this._timeline = null;
      this._totalFrames = 1;
      this._startSoundRegistrations = [];
      this._allowFrameNavigation = true;

      var s = this.symbol;
      if (s) {
        this._timeline = s.timeline || null;
        this._framesLoaded = s.framesLoaded || 1;
        this._labelMap = Object.create(s.labelMap || null);
        this._frameScripts = Object.create(s.frameScripts || null);
        this._totalFrames = s.totalFrames || 1;
        this._startSoundRegistrations = s.startSoundRegistrations || [];
        this._scenes = s.scenes || null;

        var map = this._labelMap;
        for (var name in map) {
          var frame = map[name];
          if (frame == 1) {
            this._currentFrameLabel = this._currentLabel = name;
          }
        }
      }

      this._enterFrame(1);

      var self = this;

      this._onExecuteFrame = function onExecuteFrame() {
        self._removeEventListener('executeFrame', onExecuteFrame);

        // Call frame scripts.
        self._allowFrameNavigation = false;
        self._callFrame(self._currentFrame);
        self._allowFrameNavigation = true;

        // If playhead moved, process deferred inter-frame navigation.
        if (self._playHead !== self._currentFrame) {
          self._gotoFrame(self._playHead, true);
        }
      };
      this._addEventListener('executeFrame', this._onExecuteFrame);

      if (this._totalFrames <= 1) {
        return this;
      }

      this._onAdvanceFrame = function onAdvanceFrame() {
        var frameNum = self._playHead + 1;

        if (frameNum > self._totalFrames) {
          frameNum = 1;
        } else if (frameNum > self._framesLoaded) {
          return;
        }

        // Destroy current timeline objects that are not on next frame.
        self._destructChildren(frameNum);

        // Declare current timeline objects that were not on last frame.
        self._declareChildren(frameNum);

        if (self._sparse) {
          self._addEventListener('constructChildren', self._onConstructChildren);
        }

        self._startSounds(frameNum);
        self._enterFrame(frameNum);

        if (frameNum in self._frameScripts) {
          self._addEventListener('executeFrame', self._onExecuteFrame);
        }
      };

      this._onConstructChildren = function onConstructChildren() {
        self._removeEventListener('constructChildren', onConstructChildren);

        // Run each new children's constructor.
        self._constructChildren();
      };

      this.play();
    },

    _declareChildren: function declareChildren(nextFrameNum) {
      var currentFrame = this._currentFrame;

      if (nextFrameNum === currentFrame) {
        return;
      }

      var timeline = this._timeline;
      var currentDisplayList = timeline[currentFrame - 1];
      var nextDisplayList = timeline[nextFrameNum - 1];

      if (nextDisplayList === currentDisplayList) {
        return;
      }

      var children = this._children;
      var depths = nextFrameNum > currentFrame ? nextDisplayList.depths :
                                                 currentDisplayList.depths;

      var depthMap = this._depthMap;

      var index = children.length;

      var i = depths.length;
      while (i--) {
        var depth = depths[i];
        var currentCmd = currentDisplayList[depth];
        var nextCmd = nextDisplayList[depth];

        var currentChild = depthMap[depth];

        if (currentChild && currentChild._owned) {
          index = this.getChildIndex(currentChild);
        }

        if (!nextCmd || nextCmd === currentCmd) {
          continue;
        }

        if (currentCmd &&
            currentChild && currentChild._animated &&
            nextCmd.symbolId === currentCmd.symbolId &&
            nextCmd.ratio === currentCmd.ratio) {
          currentChild._invalidate();
          currentChild._bounds = null;

          if (nextCmd.hasMatrix) {
            var m = nextCmd.matrix;
            var a = m.a;
            var b = m.b;
            var c = m.c;
            var d = m.d;

            currentChild._rotation = Math.atan2(b, a) * 180 / Math.PI;
            var sx = Math.sqrt(a * a + b * b);
            currentChild._scaleX = a > 0 ? sx : -sx;
            var sy = Math.sqrt(d * d + c * c);
            currentChild._scaleY = d > 0 ? sy : -sy;
            var x = currentChild._x = m.tx;
            var y = currentChild._y = m.ty;

            currentChild._currentTransform = m;
          }

          if (nextCmd.hasCxform) {
            currentChild._cxform = nextCmd.cxform;
          }
          if (nextCmd.clip) {
            currentChild._clipDepth = nextCmd.clipDepth;
          }

          if (nextCmd.hasName) {
            currentChild.name = nextCmd.name;
          }
          //if (nextCmd.blend) {
          //  currentChild.blendMode = nextCmd.blendMode;
          //}

          continue;
        }

        this._addTimelineChild(nextCmd, index);
      }
    },
    _destructChildren: function destructObjects(nextFrameNum) {
      var currentFrame = this._currentFrame;

      if (nextFrameNum === currentFrame) {
        return;
      }

      var timeline = this._timeline;
      var currentDisplayList = timeline[currentFrame - 1];
      var nextDisplayList = timeline[nextFrameNum - 1];

      if (nextDisplayList === currentDisplayList) {
        return;
      }

      var children = this._children;
      var depths = nextFrameNum > currentFrame ? currentDisplayList.depths:
                                                 nextDisplayList.depths;

      var depthMap = this._depthMap;

      for (var i = 0; i < depths.length; i++) {
        var depth = depths[i];
        var child = depthMap[depth];

        if (!child || !child._owned) {
          continue;
        }

        var currentCmd = currentDisplayList[depth];
        var nextCmd = nextDisplayList[depth];

        if (!nextCmd || nextCmd.symbolId !== currentCmd.symbolId ||
                        nextCmd.ratio !== currentCmd.ratio) {
          this.removeChild(child);

          child.destroy();

          if (child._isPlaying) {
            child.stop();
          }

          depthMap[depth] = null;

          child._depth = null;
        }
      }
    },

    _gotoFrame: function gotoFrame(frameNum, execute) {
      var enterFrame = frameNum !== this._currentFrame;

      if (this._allowFrameNavigation || !this._loader._isAvm2Enabled) {
        if (enterFrame) {
          this._destructChildren(frameNum);
          this._declareChildren(frameNum);
          this._enterFrame(frameNum);
        }

        this._constructChildren();

        if (this._loader._isAvm2Enabled && this.loaderInfo._swfVersion >= 10) {
          if (enterFrame) {
            this._addEventListener('executeFrame', this._onExecuteFrame);
          }

          var domain = avm2.systemDomain;
          domain.broadcastMessage("frameConstructed");
          domain.broadcastMessage("executeFrame");
          domain.broadcastMessage("exitFrame");

          return;
        }

        if (enterFrame && execute) {
          this._callFrame(frameNum);
        }

        return;
      }

      if (enterFrame) {
        this._playHead = frameNum;
      }
    },
    _enterFrame: function navigate(frameNum) {
      if (frameNum === this._currentFrame) {
        return;
      }

      // update currentLabel and currentFrameLabel
      this._currentFrameLabel = null;
      if (frameNum === 1) {
        this._currentLabel = null;
      }
      var map = this._labelMap;
      for (var name in map) {
        if (map[name] === frameNum) {
          this._currentFrameLabel = this._currentLabel = name;
          break;
        }
      }

      // update currentScene
      if (this._scenes) {
        var scenes = this._scenes;
        for (var j = 0, n = scenes.length; j < n; j++) {
          var scene = scenes[j];
          if (frameNum >= scene._startFrame && frameNum <= scene._endFrame) {
            this._currentScene = j;
            break;
          }
        }
      }

      this._playHead = this._currentFrame = frameNum;
    },
    _callFrame: function callFrame(frame) {
      if (isNaN(frame)) {
        frame = this._labelMap[frame];
        if (frame === undefined) {
          return;
        }
      }

      if (frame in this._frameScripts) {
        var scripts = this._frameScripts[frame];
        try {
          for (var i = 0, n = scripts.length; i < n; i++) {
            scripts[i].call(this);
          }
        } catch (e) {
          if ($DEBUG) {
            console.error('error ' + e + ', stack: \n' + e.stack);
          }
          this.stop();
          throw e;
        }
      }
    },

    _gotoButtonState: function gotoButtonState(stateName) {
      if (this._enabled) {
        this.gotoLabel('_' + stateName);
      }
    },

    _getAbsFrameNum: function (frameNum, scene) {
      // If a scene name is specified in gotoAndStop or gotoAndPlay,
      // and the specified frame is a number, the frame number is
      // relative to the scene.
      if (typeof scene === "string" && this._scenes && this._scenes.length > 1) {
        var scenes = this._scenes;
        for (var i = 0, n = scenes.length; i < n; i++) {
          if (scene === scenes[i].name) {
            frameNum += (scenes[i]._startFrame - 1);
            break;
          }
        }
      }

      // TODO: validate frameNum

      return frameNum;
    },

    _registerStartSounds: function (frameNum, starts) {
      this._startSoundRegistrations[frameNum] = starts;
    },
    _initSoundStream: function (streamInfo) {
      var soundStream = this._soundStream = {
        data: {
          pcm: new Float32Array(streamInfo.samplesCount * streamInfo.channels),
          sampleRate: streamInfo.sampleRate,
          channels: streamInfo.channels
        },
        seekIndex: [],
        position: 0
      };
      if (streamInfo.format === 'mp3') {
        soundStream.decoderPosition = 0;
        soundStream.decoderSession = new MP3DecoderSession();
        soundStream.decoderSession.onframedata = function (frameData) {
          var position = soundStream.decoderPosition;
          soundStream.data.pcm.set(frameData, position);
          soundStream.decoderPosition = position + frameData.length;
        }.bind(this);
        soundStream.decoderSession.onerror = function (error) {
          console.error('ERROR: MP3DecoderSession: ' + error);
        };
        // TODO close the session somewhere
      }
    },
    _addSoundStreamBlock: function (frameNum, streamBlock) {
      var soundStream = this._soundStream;
      var streamPosition = soundStream.position;
      soundStream.seekIndex[frameNum] = streamPosition +
        streamBlock.seek * soundStream.data.channels;
      soundStream.position = streamPosition +
        streamBlock.samplesCount * soundStream.data.channels;

      var decoderSession = soundStream.decoderSession;
      if (decoderSession) {
        decoderSession.pushAsync(streamBlock.data);
      } else {
        soundStream.data.pcm.set(streamBlock.pcm, streamPosition);
      }
    },
    _startSounds: function (frameNum) {
      var starts = this._startSoundRegistrations[frameNum];
      if (starts) {
        var sounds = this._sounds || (this._sounds = {});
        var loader = this.loaderInfo._loader;
        for (var i = 0; i < starts.length; i++) {
          var start = starts[i];
          var symbolId = start.soundId;
          var info = start.soundInfo;
          var sound = sounds[symbolId];
          if (!sound) {
            var symbolPromise = loader._dictionary[symbolId];
            var symbolInfo = symbolPromise.value;
            if (!symbolInfo)
              continue;

            var symbolClass = avm2.systemDomain.findClass(symbolInfo.className) ?
              avm2.systemDomain.getClass(symbolInfo.className) :
              avm2.applicationDomain.getClass(symbolInfo.className);

            var soundObj = symbolClass.createAsSymbol(symbolInfo.props);
            symbolClass.instanceConstructor.call(soundObj);
            sounds[symbolId] = sound = { object: soundObj };
          }

          if (sound.channel) {
            sound.channel.stop();
            delete sound.channel;
          }
          if (!info.stop) {
            // TODO envelope, in/out point
            var loops = info.hasLoops ? info.loopCount : 0;
            sound.channel = sound.object.play(0, loops);
          }
        }
      }
      if (this._soundStream) {
        // Start from some seek offset, stopping
        if (!this._soundStream.sound && this._soundStream.seekIndex[frameNum]) {
          var className = 'flash.media.Sound';
          var symbolClass = avm2.systemDomain.findClass(className) ?
            avm2.systemDomain.getClass(className) :
            avm2.applicationDomain.getClass(className);

          var sound = symbolClass.createAsSymbol(this._soundStream.data);
          symbolClass.instanceConstructor.call(sound);
          var channel = sound.play();
          this._soundStream.sound = sound;
          this._soundStream.channel = channel;
        }
      }
    },

    _getAS2Object: function () {
      if (!this.$as2Object) {
        if (this._avm1SymbolClass) {
          // hacking wrapper to pass/initialize AS2MovieClip with nativeObject before AS2 constructor is run
          var nativeObject = this, nativeObjectClass = this._avm1SymbolClass;
          var constructWrapper = function () {
            this.init(nativeObject);
            nativeObjectClass.call(this);
          };
          constructWrapper.prototype = Object.create(nativeObjectClass.prototype);
          constructWrapper.instanceConstructor = constructWrapper;
          constructWrapper.debugName = 'avm1 <symbol constructor wrapper>';
          construct(constructWrapper);
        } else {
          new avm1lib.AS2MovieClip(this);
        }
      }
      return this.$as2Object;
    },

    get currentFrame() {
      // currentFrame is relative to the current scene, if available
      var frameNum = this._currentFrame;
      return this._scenes ?
              frameNum - this.currentScene._startFrame + 1 :
              frameNum;
    },
    get currentFrameLabel() {
      return this._currentFrameLabel;
    },
    get currentLabel() {
      return this._currentLabel;
    },
    get currentLabels() {
      // Returns an array of FrameLabel objects from the current scene.
      // If the MovieClip instance does not use scenes, the array includes all
      // frame labels from the entire MovieClip instance
      if (this._scenes) {
        return this._scenes[this._currentScene].labels;
      } else {
        var labels = [];
        var map = this._labelMap;
        for (var name in map) {
          labels.push(new flash.display.FrameLabel(name, map[name]));
        }
        return labels;
      }
    },
    get currentScene() {
      // The current scene in which the playhead is located in the timeline of
      // the MovieClip instance. Returns a new Scene instance with empty name
      // if the MovieClip instance does not use scenes.
      return this._scenes ?
              this._scenes[this._currentScene] :
              new flash.display.Scene("", this.currentLabels, this._totalFrames);
    },
    get enabled() {
      return this._enabled;
    },
    set enabled(val) {
      this._enabled = val;
    },
    get framesLoaded() {
      return this._framesLoaded;
    },
    get totalFrames() {
      return this._totalFrames;
    },
    get scenes() {
      return this._scenes;
    },
    get trackAsMenu() {
      return false;
    },
    set trackAsMenu(val) {
      notImplemented();
    },

    addFrameScript: function () {
      // arguments are pairs of frameIndex and script/function
      // frameIndex is in range 0..totalFrames-1
      var frameScripts = this._frameScripts;
      for (var i = 0, n = arguments.length; i < n; i += 2) {
        var frameNum = arguments[i] + 1;
        var fn = arguments[i + 1];
        var scripts = frameScripts[frameNum];
        if (scripts) {
          scripts.push(fn);
        } else {
          frameScripts[frameNum] = [fn];
        }
        if (frameNum === this._currentFrame) {
          this._addEventListener('executeFrame', this._onExecuteFrame);
        }
      }
    },
    gotoAndPlay: function (frame, scene) {
      this.play();
      if (isNaN(frame)) {
        this.gotoLabel(frame);
      } else {
        this._gotoFrame(this._getAbsFrameNum(frame, scene));
      }
    },
    gotoAndStop: function (frame, scene) {
      this.stop();
      if (isNaN(frame)) {
        this.gotoLabel(frame);
      } else {
        this._gotoFrame(this._getAbsFrameNum(frame, scene));
      }
    },
    gotoLabel: function (labelName) {
      var frameNum = this._labelMap[labelName];
      if (frameNum !== undefined) {
        this._gotoFrame(frameNum);
      }
    },
    isPlaying: function () {
      return this._isPlaying;
    },
    nextFrame: function () {
      this.stop();
      if (this._currentFrame < this._framesLoaded) {
        this._gotoFrame(this._currentFrame + 1);
      }
    },
    nextScene: function () {
      if (this._scenes && this._currentScene < this._scenes.length - 1) {
        this._gotoFrame(this._scenes[this._currentScene + 1]._startFrame);
      }
    },
    play: function () {
      if (this._isPlaying || this._totalFrames <= 1) {
        return;
      }

      this._isPlaying = true;

      this._addEventListener('advanceFrame', this._onAdvanceFrame);
    },
    prevFrame: function () {
      this.stop();
      if (this._currentFrame > 1) {
        this._gotoFrame(this._currentFrame - 1);
      }
    },
    prevScene: function () {
      if (this._scenes && this._currentScene > 0) {
        this._gotoFrame(this._scenes[this._currentScene - 1]._startFrame);
      }
    },
    stop: function () {
      if (!this._isPlaying || this._totalFrames <= 1) {
        return;
      }

      this._isPlaying = false;

      this._removeEventListener('advanceFrame', this._onAdvanceFrame);
    }
  };

  var desc = Object.getOwnPropertyDescriptor;

  def.__glue__ = {
    native: {
      instance: {
        currentFrame: desc(def, "currentFrame"),
        framesLoaded: desc(def, "framesLoaded"),
        totalFrames: desc(def, "totalFrames"),
        trackAsMenu: desc(def, "trackAsMenu"),
        scenes: desc(def, "scenes"),
        currentScene: desc(def, "currentScene"),
        currentLabel: desc(def, "currentLabel"),
        currentFrameLabel: desc(def, "currentFrameLabel"),
        enabled: desc(def, "enabled"),
        isPlaying: desc(def, "isPlaying"),
        play: def.play,
        stop: def.stop,
        nextFrame: def.nextFrame,
        prevFrame: def.prevFrame,
        gotoAndPlay: def.gotoAndPlay,
        gotoAndStop: def.gotoAndStop,
        addFrameScript: def.addFrameScript,
        prevScene: def.prevScene,
        nextScene: def.nextScene,
        _depth: {
          get: function () { return this._depth; }
        }
      }
    }
  };

  return def;
}).call(this);

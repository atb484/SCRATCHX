(function(ext) {

    if (typeof Tone !== 'undefined') {
        console.log('Tone library is already loaded');
        startTone();
    } else {
        $.getScript('https://rawgit.com/Tonejs/CDN/gh-pages/r7/Tone.min.js', startTone);
    }

    function startTone() {

        var player = new Tone.Player().toMaster();
        var audioContext = Tone.context;

        var trackTimingData;
        var currentBeatNum = 0;
        var beatFlag = false;
        var barFlag = false;
        var beatTimeouts = [];
        var barTimeouts = [];
        var trackTimeout;

        var currentTrackDuration = 0;
        var trackTempo = 0;
        var currentArtistName = 'none';
        var currentTrackName = 'none';
        var currentAlbumName = 'none';

        // Cleanup function when the extension is unloaded
        ext._shutdown = function() {};

        // Status reporting code
        // Use this to report missing hardware, plugin or unsupported browser
        ext._getStatus = function() {
            return {status: 2, msg: 'Ready'};
        };

        ext.searchAndPlayAndWait = function(query, callback) {
            requestSearchAndPlay(query, true, callback);
        };

        ext.searchAndPlay = function(query, callback) {
            requestSearchAndPlay(query, false, callback);
        };

        function requestSearchAndPlay(query, waitForTrackToEnd, callback) {

            if (player) {
                player.stop();
            }

            $.ajax({
                url: 'https://api.spotify.com/v1/search',
                data: {
                    q: query,
                    type: 'track'
                },
                success: function (response) {
                    var trackObjects = response['tracks']['items'];

                    // fail if there are no tracks
                    if (!trackObjects) {
                        resetTrackData();
                        callback();
                        return;
                    }

                    // find the first result without explicit lyrics
                    var trackObject;
                    for (var i=0; i<trackObjects.length; i++) {
                        if (!trackObjects[i].explicit) {
                            trackObject = trackObjects[i];
                            break;
                        }
                    }

                    // fail if there were none without explicit lyrics
                    if (!trackObject) {
                        resetTrackData();
                        callback();
                        return;
                    }

                    // store track name, artist, album
                    currentArtistName = trackObject.artists[0].name;
                    currentTrackName = trackObject.name;
                    currentAlbumName = trackObject.album.name;

                    currentBeatNum = 0;

                    // download track, get timing data, and play it

                    var trackURL = trackObject.preview_url;            
                    getTrackTimingData(trackURL, trackFinishedLoading);

                    function trackFinishedLoading() {
                        if (!waitForTrackToEnd) {
                            callback();
                        } else {
                            trackTimeout = window.setTimeout(function() {
                                callback();
                            }, currentTrackDuration*1000);

                        }
                    }

                    function resetTrackData() {
                        currentArtistName = 'none';
                        currentTrackName = 'none';
                        currentAlbumName = 'none';
                        trackTempo = 0;
                    }              
                },
                error: function() {
                }
            });
        
        };

        // code adapted from spotify
        function getTrackTimingData(url, callback) {

            function findString(buffer, string) {
              for (var i = 0; i < buffer.length - string.length; i++) {
                var match = true;
                for (var j = 0; j < string.length; j++) {
                  var c = String.fromCharCode(buffer[i + j]);
                  if (c !== string[j]) {
                    match = false;
                    break;
                  }
                }
                if (match) {
                  return i;
                }
              }
              return -1;
            }

            function getSection(buffer, start, which) {
              var sectionCount = 0;
              for (var i = start; i < buffer.length; i++) {
                if (buffer[i] == 0) {
                  sectionCount++;
                }
                if (sectionCount >= which) {
                  break;
                }
              }
              i++;
              var content = '';
              while (i < buffer.length) {
                if (buffer[i] == 0) {
                  break;
                }
                var c = String.fromCharCode(buffer[i]);
                content += c;
                i++;
              }
              var js = eval('(' + content + ')');
              return js;
            }

            function makeRequest(url, callback) {
                var request = new XMLHttpRequest();
                request.open('GET', url, true);
                request.responseType = 'arraybuffer';
                request.onload = function() {
                    var buffer = new Uint8Array(this.response); // this.response == uInt8Array.buffer
                    var idx = findString(buffer, 'GEOB');

                    trackTimingData = getSection(buffer, idx + 1, 8);

                    // estimate the tempo using the average time interval between beats
                    var sum =0;
                    for (var i=0; i<trackTimingData.beats.length-1; i++) {
                        sum += trackTimingData.beats[i+1] - trackTimingData.beats[i];
                    }
                    var beatLength = sum / (trackTimingData.beats.length - 1);
                    trackTempo = 60 / beatLength;

                    // set up events to fire on each beat
                    for (var i=0; i<trackTimingData.beats.length; i++) {
                        var t = window.setTimeout(function() {
                            beatFlag = true;
                            currentBeatNum = i;
                        }.bind(i), trackTimingData.beats[i] * 1000);
                        beatTimeouts.push(t);
                    }

                    // set up events to fire on each bar
                    for (var i=0; i<trackTimingData.downbeats.length; i++) {
                        var t = window.setTimeout(function() {
                            barFlag = true;
                        }, trackTimingData.downbeats[i] * 1000);
                        barTimeouts.push(t);
                    }

                    // decode and play the audio
                    audioContext.decodeAudioData(request.response, function(buffer) {
                        player.buffer.set(buffer);
                        player.start();
                        currentTrackDuration = player.buffer.duration;
                        callback();
                    });
                }
                request.send();
            }

            makeRequest(url, callback);
        }

        ext.trackName = function() {
            return currentTrackName;
        };

        ext.artistName = function() {
            return currentArtistName;
        };

        ext.albumName = function() {
            return currentAlbumName;
        };

        ext.trackTempo = function() {
            return trackTempo;
        };

        ext.playNextBeat = function() {
            if (player) {
                currentBeatNum++;
                currentBeatNum %= trackTimingData.beats.length;
                playCurrentBeat();
            }
        };

        function playCurrentBeat() {
            var startTime = trackTimingData.beats[currentBeatNum];
            var duration;
            if ((currentBeatNum + 1) < trackTimingData.beats.length) {
                var endTime = trackTimingData.beats[currentBeatNum+1];
                duration = endTime - startTime;
            } else {
                duration = currentTrackDuration - startTime;
            }
            player.stop();
            player.start('+0', startTime, duration);
        }

        ext.currentBeat = function() {
            return currentBeatNum;
        };

        ext.playBeat = function(num) {
            if (player) {
                currentBeatNum = num % trackTimingData.beats.length;
                if (currentBeatNum < 0) {
                    currentBeatNum += trackTimingData.beats.length;
                }
                playCurrentBeat();
            }
        }

        ext.stopMusic = function() {
            player.stop();
            clearTimeouts();
        };

        function clearTimeouts() {
            clearTimeout(trackTimeout);
            for (var i=0; i<beatTimeouts.length; i++) {
                clearTimeout(beatTimeouts[i]);
            }
            for (var i=0; i<barTimeouts.length; i++) {
                clearTimeout(barTimeouts[i]);
            }
        }

        ext.everyBeat = function() {
            if (beatFlag) {
                window.setTimeout(function() {
                    beatFlag = false;
                }, 100);
                return true;
            }
            return false;
        };

        ext.everyBar = function() {
            if (barFlag) {
                window.setTimeout(function() {
                    barFlag = false;
                }, 100);
                return true;
            }
            return false;
        };

        // Block and block menu descriptions
        var descriptor = {
            blocks: [
              ['w', 'play music like %s', 'searchAndPlay', 'happy'],
              ['w', 'play music like %s and wait', 'searchAndPlayAndWait', 'michael jackson'],
              ['r', 'track name', 'trackName'],
              ['r', 'artist name', 'artistName'],
              ['r', 'album name', 'albumName'],
              ['r', 'track tempo', 'trackTempo'],
              [' ', 'play next beat', 'playNextBeat'],
              ['r', 'current beat', 'currentBeat'],
              [' ', 'play beat %n', 'playBeat', 4],
              [' ', 'stop the music', 'stopMusic'],
              ['h', 'every beat', 'everyBeat'],
              ['h', 'every bar', 'everyBar'],

            ]
        };

        // Register the extension
        ScratchExtensions.register('Spotify', descriptor, ext);
    }

})({});
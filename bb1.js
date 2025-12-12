// ===== WAIT UNTIL PAGE LOADED =====
window.addEventListener("load", () => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const muteButton = document.getElementById("muteButton");

  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;

  // ===== BALLS (supports MULTI-BALL) =====
  const BASE_BALL_RADIUS = 8;
  const MAX_BALLS = 4;
  let balls = []; // each ball: { x, y, dx, dy, r }

  // Big ball & score multiplier
  const MAX_BIG_BALL_LEVEL = 4;
  let bigBallLevel = 0;     // 0–4
  let scoreMultiplier = 1;  // 1 or 2

  // ===== PADDLE =====
  const paddleHeight = 10;
  const paddleWidth = 75;
  const paddleY = HEIGHT - paddleHeight - 5;
  const basePaddleSpeed = 5;
  let paddleSpeed = basePaddleSpeed;
  let paddleX = (WIDTH - paddleWidth) / 2;

  let rightPressed = false;
  let leftPressed = false;

  // ===== GAME STATE =====
  let isRunning = false;     // balls moving?
  let overlayActive = false; // any overlay visible?
  let overlayType = "none";  // "none" | "gameover" | "win" | "level"
  let level = 1;
  const maxLevel = 5;
  let lastCompletedLevel = 0; // for level-complete text

  // ===== SCORE + HIGH SCORE =====
  let score = 0;
  let highScore = 0;

  try {
    const storedHigh = localStorage.getItem("bbHighScore");
    if (storedHigh) {
      highScore = parseInt(storedHigh, 10) || 0;
    }
  } catch (e) {
    // localStorage might be disabled; fail silently
    highScore = 0;
  }

  // ===== BRICKS =====
  const brickColumnCount = 7;
  const baseRowCount = 4;  // rows in level 1
  const maxRowCount = 8;   // max rows
  const brickWidth = 50;
  const brickHeight = 15;
  const brickPadding = 5;
  const brickOffsetTop = 30;

  let currentRowCount = baseRowCount;
  let brickOffsetLeft = 0;        // dynamic – can move from level 3
  let currentTotalBricksWidth = 0;
  // bricks[c][r] = { x, y, status, buff, ice }
  let bricks = [];
  let bricksRemaining = 0;

  // ===== BUFFS =====
  const buffSize = 14;
  const buffFallSpeed = 2.5;
  // type: "multi" | "big" | "clear" | "speed"
  let activeBuffs = [];      // each buff: { x, y, vy, type, active }

  // ===== SOUND SYSTEM =====
  let soundEnabled = true;
  let bgMusicStarted = false;

  function createAudio(src, volume = 1.0, loop = false) {
    let audio = null;
    try {
      audio = new Audio(src);
      audio.volume = volume;
      audio.loop = loop;
    } catch (e) {
      console.warn("Audio not supported or failed to load:", src, e);
      return null;
    }
    return audio;
  }

  const sfxPaddleHit     = createAudio("paddle_hit+wall_hit.wav", 0.5);
  const sfxBrickHit      = createAudio("break_hit.wav",           0.5);
  const sfxWallHit       = createAudio("paddle_hit+wall_hit.wav", 0.35);
  const sfxBuffPickup    = createAudio("buff_pickup.mp3",         0.6);
  const sfxLevelComplete = createAudio("win_level.mp3",           0.7);
  const sfxGameOver      = createAudio("Game_over.wav",           0.7);
  const sfxWin           = createAudio("win_level.mp3",           0.7);
  const musicBg          = createAudio("bg_music.mp3",            0.3, true);

  function playSound(audio) {
    if (!soundEnabled || !audio) return;
    try {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } catch (e) {
      // ignore playback errors
    }
  }

  function startBackgroundMusic() {
    if (!musicBg || !soundEnabled || bgMusicStarted) return;
    bgMusicStarted = true;
    try {
      musicBg.play().catch(() => {});
    } catch (e) {
      // ignore
    }
  }

  if (muteButton) {
    muteButton.addEventListener("click", () => {
      soundEnabled = !soundEnabled;
      if (!soundEnabled) {
        if (musicBg) {
          try { musicBg.pause(); } catch (e) {}
        }
        muteButton.textContent = "🔇 Sound: OFF";
      } else {
        muteButton.textContent = "🔊 Sound: ON";
        if (musicBg && bgMusicStarted) {
          try { musicBg.play().catch(() => {}); } catch (e) {}
        }
      }
      // prevent spacebar from toggling sound again by removing focus
      muteButton.blur();
    });
  }

  // ===== CHEAT STATE (L x3 to skip level) =====
  let lCount = 0;
  let lastLTime = 0;

  // ===== INPUT (keyboard) =====
  document.addEventListener("keydown", (e) => {
    // Arrow keys
    if (e.key === "ArrowRight" || e.key === "Right") {
      rightPressed = true;
    } else if (e.key === "ArrowLeft" || e.key === "Left") {
      leftPressed = true;
    }
    // Space: launch / overlays
    else if (e.code === "Space") {
      // prevent space from activating focused buttons (like mute)
      if (document.activeElement === muteButton) {
        e.preventDefault();
      }

      if (overlayActive) {
        if (overlayType === "gameover" || overlayType === "win") {
          resetFullGame(); // restart everything
        } else if (overlayType === "level") {
          // go to next level
          overlayActive = false;
          overlayType = "none";
          nextLevel();
        }
      } else if (!isRunning) {
        // launch balls from paddle
        isRunning = true;
        startBackgroundMusic();
      }
    }

    // ===== CHEAT: press L three times quickly to skip level =====
    if (e.key === "l" || e.key === "L") {
      const now = Date.now();
      if (now - lastLTime > 700) {
        lCount = 0; // too slow, reset combo
      }
      lCount++;
      lastLTime = now;

      if (lCount >= 3) {
        lCount = 0;
        console.log("CHEAT: level skipped");
        forceCompleteLevel();
      }
    }
  });

  document.addEventListener("keyup", (e) => {
    if (e.key === "ArrowRight" || e.key === "Right") {
      rightPressed = false;
    } else if (e.key === "ArrowLeft" || e.key === "Left") {
      leftPressed = false;
    }
  });

  // ===== CHEAT: force level complete safely =====
  function forceCompleteLevel() {
    if (bricks && bricks.length > 0) {
      for (let c = 0; c < bricks.length; c++) {
        const col = bricks[c];
        if (!col) continue;
        for (let r = 0; r < col.length; r++) {
          const brick = col[r];
          if (!brick) continue;
          brick.status = 0;
          brick.ice = false;
        }
      }
    }
    bricksRemaining = 0;
    handleLevelComplete();
  }

  // ===== INPUT (touch for mobile) =====

  // Double-tap state (mobile launch)
  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;
  let touchStartX = null;
  let touchStartY = null;
  const DOUBLE_TAP_MAX_DELAY = 300; // ms
  const DOUBLE_TAP_MAX_MOVE = 20;   // px in game coords

  function clampPaddleToGame() {
    if (paddleX < 0) paddleX = 0;
    if (paddleX + paddleWidth > WIDTH) paddleX = WIDTH - paddleWidth;
  }

  function handleTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = touch.clientX - rect.left;
    const clientY = touch.clientY - rect.top;
    const scaleX = WIDTH / rect.width;
    const scaleY = HEIGHT / rect.height;

    const gameX = clientX * scaleX;
    const gameY = clientY * scaleY;

    // Move paddle (existing behaviour)
    paddleX = gameX - paddleWidth / 2;
    clampPaddleToGame();

    // Remember start position for double-tap detection
    touchStartX = gameX;
    touchStartY = gameY;

    // Start music on first interaction
    startBackgroundMusic();
  }

  function handleTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = touch.clientX - rect.left;
    const scaleX = WIDTH / rect.width;
    const gameX = clientX * scaleX;

    paddleX = gameX - paddleWidth / 2;
    clampPaddleToGame();
  }

  function handleTouchEnd(e) {
    e.preventDefault();

    // If we never got a valid start, nothing to check
    if (touchStartX == null || touchStartY == null) {
      return;
    }

    const now = Date.now();
    const timeSinceLastTap = now - lastTapTime;

    const dx = touchStartX - lastTapX;
    const dy = touchStartY - lastTapY;
    const distSq = dx * dx + dy * dy;

    const isDoubleTap =
      timeSinceLastTap <= DOUBLE_TAP_MAX_DELAY &&
      distSq <= DOUBLE_TAP_MAX_MOVE * DOUBLE_TAP_MAX_MOVE;

    if (isDoubleTap) {
      // Behaviour mirrors SPACEBAR:
      if (overlayActive) {
        if (overlayType === "gameover" || overlayType === "win") {
          resetFullGame();
        } else if (overlayType === "level") {
          overlayActive = false;
          overlayType = "none";
          nextLevel();
        }
      } else if (!isRunning) {
        isRunning = true;
        startBackgroundMusic();
      }

      // Reset tap state
      lastTapTime = 0;
      lastTapX = 0;
      lastTapY = 0;
    } else {
      // Treat this as first tap
      lastTapTime = now;
      lastTapX = touchStartX;
      lastTapY = touchStartY;
    }

    touchStartX = null;
    touchStartY = null;
  }

  canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
  canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
  canvas.addEventListener("touchend", handleTouchEnd, { passive: false });

  // ===== BRICK INITIALIZATION =====
  function initBricks() {
    currentRowCount = Math.min(baseRowCount + (level - 1), maxRowCount);
    bricks = [];
    bricksRemaining = 0;

    const totalBricksWidth =
      brickColumnCount * brickWidth + (brickColumnCount - 1) * brickPadding;
    currentTotalBricksWidth = totalBricksWidth;
    brickOffsetLeft = (WIDTH - totalBricksWidth) / 2;

    for (let c = 0; c < brickColumnCount; c++) {
      bricks[c] = [];
      for (let r = 0; r < currentRowCount; r++) {
        // Top row bricks are "ice" (hard, 2 hits)
        const isIce = (r === 0);
        bricks[c][r] = {
          x: 0,
          y: 0,
          status: 1,   // 1 = visible / still has brick
          buff: null,  // "multi"/"big"/"clear"/"speed" or null
          ice: isIce   // true = ice layer present, first hit breaks ice
        };
        bricksRemaining++;
      }
    }

    assignBuffsToBricks();
  }

  // Randomly attach up to 4 buffs (one of each type) to random bricks
  function assignBuffsToBricks() {
    const buffTypes = ["multi", "big", "clear", "speed"];
    const brickCoords = [];

    for (let c = 0; c < brickColumnCount; c++) {
      for (let r = 0; r < currentRowCount; r++) {
        brickCoords.push({ c, r });
      }
    }

    // simple shuffle
    for (let i = brickCoords.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [brickCoords[i], brickCoords[j]] = [brickCoords[j], brickCoords[i]];
    }

    let idx = 0;
    for (let t = 0; t < buffTypes.length; t++) {
      if (idx >= brickCoords.length) break;
      const coord = brickCoords[idx++];
      bricks[coord.c][coord.r].buff = buffTypes[t];
    }
  }

  // ===== DRAWING =====
  function getBallRadius() {
    // Each big-ball buff adds ~30% size, up to 4 times.
    return BASE_BALL_RADIUS * (1 + 0.3 * bigBallLevel);
  }

  function drawBall(ball) {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fillStyle = "#00ff00";
    ctx.fill();
    ctx.closePath();
  }

  function drawBalls() {
    for (const ball of balls) {
      drawBall(ball);
    }
  }

  function drawPaddle() {
    ctx.beginPath();
    ctx.rect(paddleX, paddleY, paddleWidth, paddleHeight);
    ctx.fillStyle = "#0095DD";
    ctx.fill();
    ctx.closePath();
  }

  function drawBricks() {
    for (let c = 0; c < brickColumnCount; c++) {
      for (let r = 0; r < currentRowCount; r++) {
        const b = bricks[c][r];
        if (b && b.status === 1) {
          const brickX =
            brickOffsetLeft + c * (brickWidth + brickPadding);
          const brickY =
            brickOffsetTop + r * (brickHeight + brickPadding);
          b.x = brickX;
          b.y = brickY;

          // Base brick
          ctx.beginPath();
          ctx.rect(brickX, brickY, brickWidth, brickHeight);
          ctx.fillStyle = "#ff9933";
          ctx.fill();
          ctx.closePath();

          // Ice layer overlay (visual "frozen" bricks)
          if (b.ice) {
            ctx.beginPath();
            ctx.rect(brickX + 2, brickY + 2, brickWidth - 4, brickHeight - 4);
            ctx.fillStyle = "#aee7ff"; // light icy blue
            ctx.fill();
            ctx.closePath();

            // Simple "crack" line to sell the ice look
            ctx.beginPath();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1;
            ctx.moveTo(brickX + 4, brickY + 4);
            ctx.lineTo(brickX + brickWidth - 4, brickY + brickHeight - 4);
            ctx.stroke();
            ctx.closePath();
          }
        }
      }
    }
  }

  function drawScoreAndLevel() {
    ctx.font = "14px Arial";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(
      `Score: ${score}   High: ${highScore}   Level: ${level}`,
      WIDTH / 2,
      20
    );
  }

  function drawInstructions() {
    if (!isRunning && !overlayActive) {
      ctx.font = "14px Arial";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.fillText(
        "Move with \u2190 \u2192 , press SPACE (or double-tap) to launch",
        WIDTH / 2,
        HEIGHT / 2
      );
    }
  }

  function drawBuffs() {
    for (const buff of activeBuffs) {
      if (!buff.active) continue;
      ctx.beginPath();
      ctx.rect(buff.x - buffSize / 2, buff.y - buffSize / 2, buffSize, buffSize);

      if (buff.type === "multi") ctx.fillStyle = "#ff66ff";
      else if (buff.type === "big") ctx.fillStyle = "#66ff66";
      else if (buff.type === "clear") ctx.fillStyle = "#ffff66";
      else if (buff.type === "speed") ctx.fillStyle = "#66ccff";
      else ctx.fillStyle = "#ffffff";

      ctx.fill();
      ctx.closePath();

      // label letter
      ctx.font = "10px Arial";
      ctx.fillStyle = "#000000";
      ctx.textAlign = "center";
      let label = "?";
      if (buff.type === "multi") label = "M";
      if (buff.type === "big") label = "B";
      if (buff.type === "clear") label = "C";
      if (buff.type === "speed") label = "S";
      ctx.fillText(label, buff.x, buff.y + 3);
    }
  }

  function drawOverlay() {
    if (!overlayActive) return;

    // dark overlay
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    let mainText = "";
    let subText = "";
    let mainColor1 = "#ff3366";
    let mainColor2 = "#ffffff";

    if (overlayType === "gameover") {
      mainText = "GAME OVER";
      subText = "Press SPACE or double-tap to restart";
      mainColor1 = "#ff3366"; // reddish
      mainColor2 = "#ffffff";
    } else if (overlayType === "win") {
      mainText = "YOU HAVE WON LEVEL 5!";
      subText = "Press SPACE or double-tap to play again";
      mainColor1 = "#33ff66"; // greenish
      mainColor2 = "#ffffff";
    } else if (overlayType === "level") {
      mainText = `LEVEL ${lastCompletedLevel} COMPLETE`;
      subText = "Press SPACE or double-tap for the next level";
      mainColor1 = "#33ccff"; // blue/cyan
      mainColor2 = "#ffff66"; // yellow-ish
    }

    // glitchy effect for main text
    const baseFontSize =
      overlayType === "win" ? 22 : 20; // win slightly larger
    for (let i = 0; i < 5; i++) {
      const offsetX = (Math.random() - 0.5) * 4;
      const offsetY = (Math.random() - 0.5) * 4;
      ctx.font = baseFontSize + "px Arial";
      ctx.textAlign = "center";
      ctx.fillStyle = i % 2 === 0 ? mainColor1 : mainColor2;
      ctx.fillText(
        mainText,
        WIDTH / 2 + offsetX,
        HEIGHT / 2 + offsetY
      );
    }

    ctx.font = "16px Arial";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(subText, WIDTH / 2, HEIGHT / 2 + 40);
  }

  function clearCanvas() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
  }

  // ===== PADDLE BOUNCE ANGLE =====
  function handlePaddleBounce(ball) {
    // Place ball just above paddle
    ball.y = paddleY - ball.r - 1;

    // Distance from paddle center -> [-paddleWidth/2, +paddleWidth/2]
    const paddleCenter = paddleX + paddleWidth / 2;
    const distanceFromCenter = ball.x - paddleCenter;

    // Normalize to [-1, 1]
    const normalized = distanceFromCenter / (paddleWidth / 2);
    const clamped = Math.max(-1, Math.min(1, normalized));

    // Max angle away from straight up (in radians)
    const maxBounceAngle = (75 * Math.PI) / 180;
    const bounceAngle = clamped * maxBounceAngle;

    // Keep speed magnitude
    const currentSpeed = Math.hypot(ball.dx, ball.dy) || 4;

    // Angle measured from vertical:
    ball.dx = currentSpeed * Math.sin(bounceAngle);
    ball.dy = -currentSpeed * Math.cos(bounceAngle);
  }

  // ===== GAME LOGIC =====

  function updateBalls() {
    if (overlayActive) return;

    if (!isRunning) {
      // all balls sit on paddle when paused
      for (const ball of balls) {
        ball.x = paddleX + paddleWidth / 2;
        ball.y = paddleY - ball.r - 1;
      }
      return;
    }

    const remainingBalls = [];

    for (const ball of balls) {
      ball.x += ball.dx;
      ball.y += ball.dy;

      // walls
      if (ball.x + ball.r > WIDTH || ball.x - ball.r < 0) {
        ball.dx = -ball.dx;
        playSound(sfxWallHit);
      }
      if (ball.y - ball.r < 0) {
        ball.dy = -ball.dy;
        playSound(sfxWallHit);
      }

      // paddle collision (uses angled bounce)
      if (
        ball.y + ball.r >= paddleY &&
        ball.x >= paddleX &&
        ball.x <= paddleX + paddleWidth &&
        ball.dy > 0
      ) {
        handlePaddleBounce(ball);
        playSound(sfxPaddleHit);
      }

      // bottom -> ball lost
      if (ball.y - ball.r > HEIGHT) {
        // ball is lost, do NOT push into remainingBalls
      } else {
        remainingBalls.push(ball);
      }
    }

    balls = remainingBalls;

    // if all balls lost -> game over
    if (balls.length === 0) {
      triggerGameOver();
    }
  }

  // Circle–rectangle based brick collisions for each ball
  function checkBrickCollisions() {
    if (overlayActive) return;

    outerLoop:
    for (let c = 0; c < brickColumnCount; c++) {
      for (let r = 0; r < currentRowCount; r++) {
        const b = bricks[c][r];
        if (!b || b.status !== 1) continue;

        for (const ball of balls) {
          const closestX = Math.max(b.x, Math.min(ball.x, b.x + brickWidth));
          const closestY = Math.max(b.y, Math.min(ball.y, b.y + brickHeight));
          const dx = ball.x - closestX;
          const dy = ball.y - closestY;

          if (dx * dx + dy * dy < ball.r * ball.r) {
            // bounce direction
            if (Math.abs(dx) > Math.abs(dy)) {
              ball.dx = -ball.dx;
            } else {
              ball.dy = -ball.dy;
            }

            // brick hit sound
            playSound(sfxBrickHit);

            // HARD / ICE BRICK LOGIC
            if (b.ice) {
              // First hit: break the ice only, brick stays
              b.ice = false;
            } else {
              // Normal hit (or second hit on ice brick): destroy the brick
              b.status = 0;
              bricksRemaining--;
              score += 10 * scoreMultiplier;

              // high score
              try {
                if (score > highScore) {
                  highScore = score;
                  localStorage.setItem("bbHighScore", highScore.toString());
                }
              } catch (e) {
                // ignore storage errors
              }

              // spawn buff if any (only when brick actually destroyed)
              if (b.buff) {
                spawnBuffFromBrick(b);
                b.buff = null;
              }

              // level complete?
              if (bricksRemaining === 0) {
                handleLevelComplete();
              }
            }

            // stop after first collision to avoid double-breaking
            break outerLoop;
          }
        }
      }
    }
  }

  function updatePaddle() {
    if (overlayActive) return;

    const prevX = paddleX;

    if (rightPressed && paddleX + paddleWidth < WIDTH) {
      paddleX += paddleSpeed;
    } else if (leftPressed && paddleX > 0) {
      paddleX -= paddleSpeed;
    }

    // clamp
    if (paddleX < 0) paddleX = 0;
    if (paddleX + paddleWidth > WIDTH) paddleX = WIDTH - paddleWidth;

    const deltaX = paddleX - prevX;

    // From level 3 and up: bricks follow the paddle horizontally
    if (level >= 3 && !overlayActive && deltaX !== 0) {
      let newOffset = brickOffsetLeft + deltaX;
      const minOffset = 0;
      const maxOffset = WIDTH - currentTotalBricksWidth;
      if (newOffset < minOffset) newOffset = minOffset;
      if (newOffset > maxOffset) newOffset = maxOffset;
      brickOffsetLeft = newOffset;
    }
  }

  function updateBuffs() {
    if (overlayActive) return;

    for (const buff of activeBuffs) {
      if (!buff.active) continue;

      buff.y += buff.vy;

      // check collision with paddle
      const left = buff.x - buffSize / 2;
      const right = buff.x + buffSize / 2;
      const top = buff.y - buffSize / 2;
      const bottom = buff.y + buffSize / 2;

      const hitPaddle =
        bottom >= paddleY &&
        top <= paddleY + paddleHeight &&
        right >= paddleX &&
        left <= paddleX + paddleWidth;

      if (hitPaddle) {
        buff.active = false;
        applyBuff(buff.type);
        playSound(sfxBuffPickup);
      } else if (top > HEIGHT) {
        // fell off screen
        buff.active = false;
      }
    }

    // clean inactive buffs
    activeBuffs = activeBuffs.filter(b => b.active);
  }

  function update() {
    updateBalls();
    updatePaddle();
    updateBuffs();
    checkBrickCollisions();
  }

  function draw() {
    clearCanvas();
    drawBricks();
    drawBalls();
    drawPaddle();
    drawScoreAndLevel();
    drawBuffs();
    drawInstructions();
    drawOverlay();
  }

  function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
  }

  // ===== BUFF LOGIC =====

  function spawnBuffFromBrick(brick) {
    activeBuffs.push({
      x: brick.x + brickWidth / 2,
      y: brick.y + brickHeight / 2,
      vy: buffFallSpeed,
      type: brick.buff,
      active: true
    });
  }

  function applyBuff(type) {
    if (type === "multi") {
      applyMultiBallBuff();
    } else if (type === "big") {
      applyBigBallBuff();
    } else if (type === "clear") {
      applyClearBuff();
    } else if (type === "speed") {
      applySpeedBuff();
    }
  }

  function applyMultiBallBuff() {
    // double number of balls up to MAX_BALLS
    const currentCount = balls.length;
    const targetCount = Math.min(MAX_BALLS, currentCount * 2);

    if (currentCount === 0) return;

    while (balls.length < targetCount) {
      const base = balls[balls.length - 1]; // copy last ball
      const angleJitter = (Math.random() - 0.5) * 0.4;
      const speed = Math.sqrt(base.dx * base.dx + base.dy * base.dy) || 3;
      const angle = Math.atan2(base.dy, base.dx) + angleJitter;

      balls.push({
        x: base.x,
        y: base.y,
        dx: Math.cos(angle) * speed,
        dy: Math.sin(angle) * speed,
        r: base.r
      });
    }
  }

  function applyBigBallBuff() {
    if (bigBallLevel < MAX_BIG_BALL_LEVEL) {
      // Increase size level (max 4 times)
      bigBallLevel++;
      const newR = getBallRadius();
      for (const ball of balls) {
        ball.r = newR;
      }
    } else {
      // Already max size -> from now on, this buff gives double score
      if (scoreMultiplier < 2) {
        scoreMultiplier = 2;
      }
    }
  }

  function applyClearBuff() {
    // clear all bricks and complete level immediately
    for (let c = 0; c < brickColumnCount; c++) {
      for (let r = 0; r < currentRowCount; r++) {
        const b = bricks[c][r];
        if (b && b.status === 1) {
          b.status = 0;
          bricksRemaining--;
          score += 10 * scoreMultiplier;
        }
      }
    }

    try {
      if (score > highScore) {
        highScore = score;
        localStorage.setItem("bbHighScore", highScore.toString());
      }
    } catch (e) {
      // ignore storage errors
    }

    handleLevelComplete();
  }

  function applySpeedBuff() {
    // slightly increase paddle speed for the rest of this game
    paddleSpeed = basePaddleSpeed * 1.7;
  }

  // ===== HELPERS =====
  function resetBallsForStart() {
    balls = [];
    const speed = 3 + (level - 1) * 0.5; // slightly faster each level

    balls.push({
      x: paddleX + paddleWidth / 2,
      y: paddleY - getBallRadius() - 1,
      dx: speed * (Math.random() > 0.5 ? 1 : -1),
      dy: -speed,
      r: getBallRadius()
    });

    isRunning = false;
  }

  function resetBallAndPaddle() {
    paddleX = (WIDTH - paddleWidth) / 2;
    paddleSpeed = basePaddleSpeed;

    resetBallsForStart();
  }

  function triggerGameOver() {
    isRunning = false;
    overlayActive = true;
    overlayType = "gameover";
    playSound(sfxGameOver);
  }

  function handleLevelComplete() {
    lastCompletedLevel = level;

    if (level >= maxLevel) {
      // finished last level -> win screen
      isRunning = false;
      overlayActive = true;
      overlayType = "win";
      playSound(sfxWin);
    } else {
      // normal level complete overlay
      isRunning = false;
      overlayActive = true;
      overlayType = "level";
      playSound(sfxLevelComplete);
    }
  }

  function nextLevel() {
    level++;
    overlayActive = false;
    overlayType = "none";
    initBricks();
    // reset falling buffs so new random buffs spawn
    activeBuffs = [];
    resetBallAndPaddle();
  }

  function resetFullGame() {
    score = 0;
    level = 1;
    overlayActive = false;
    overlayType = "none";
    activeBuffs = [];
    bigBallLevel = 0;
    scoreMultiplier = 1;
    paddleSpeed = basePaddleSpeed;
    initBricks();
    resetBallAndPaddle();
  }

  // ===== START GAME =====
  initBricks();
  resetBallAndPaddle();
  gameLoop();
});

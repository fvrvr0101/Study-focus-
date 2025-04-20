/**
 * Study Focus Telegram Bot
 * A Node.js-based Telegram bot for study focus timing, task tracking, and productivity enhancement
 * All-in-one file with advanced UI and animations
 */

const TelegramBot = require('node-telegram-bot-api');
const schedule = require('node-schedule');
const moment = require('moment');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Get Telegram Bot Token from environment variable
const token = process.env.TELEGRAM_BOT_TOKEN || '';

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set! Please set it in your environment variables.');
  process.exit(1);
}

// Create a bot instance
const bot = new TelegramBot(token, { polling: true });

console.log('Starting Study Focus Bot...');

//======================================
// IN-MEMORY DATA STORE
//======================================

// Store for user data (tasks, sessions, stats)
const userStore = new Map();

/**
 * Initialize user data if it doesn't exist
 * @param {number} userId - Telegram user ID
 */
function initializeUserData(userId) {
  if (!userStore.has(userId)) {
    userStore.set(userId, {
      tasks: [],
      session: {
        isStudying: false,
        studyStartTime: null,
        pauseStartTime: null,
        totalPausedTime: 0,
        pausedDuration: 0,
        messageId: null,
        plannedDuration: 0
      },
      stats: {
        totalStudyTime: 0,  // In minutes
        totalSessions: 0,
        longestSession: 0,  // In minutes
        totalCompletedTasks: 0,
        streak: 0,
        lastStudyDate: null,
        dailyStudyTime: {}  // Map of YYYY-MM-DD -> minutes
      }
    });
  }
}

/**
 * Get user session
 * @param {number} userId - Telegram user ID
 * @returns {Object} User session object
 */
function getUserSession(userId) {
  initializeUserData(userId);
  return userStore.get(userId).session;
}

/**
 * Update user session
 * @param {number} userId - Telegram user ID
 * @param {Object} sessionData - Session data to update
 */
function updateUserSession(userId, sessionData) {
  initializeUserData(userId);
  const userData = userStore.get(userId);
  userData.session = { ...userData.session, ...sessionData };
  userStore.set(userId, userData);
}

/**
 * Get user tasks
 * @param {number} userId - Telegram user ID
 * @returns {Array} Array of user tasks
 */
function getUserTasks(userId) {
  initializeUserData(userId);
  return userStore.get(userId).tasks;
}

/**
 * Add a task for user
 * @param {number} userId - Telegram user ID
 * @param {string} taskText - Task description
 * @returns {Object} The added task
 */
function addUserTask(userId, taskText) {
  initializeUserData(userId);
  const userData = userStore.get(userId);
  
  // Generate ID based on timestamp or use 1 if first task
  const taskId = userData.tasks.length > 0 
    ? Math.max(...userData.tasks.map(t => t.id)) + 1 
    : 1;
  
  const newTask = {
    id: taskId,
    text: taskText,
    completed: false,
    createdAt: new Date()
  };
  
  userData.tasks.push(newTask);
  userStore.set(userId, userData);
  
  return newTask;
}

/**
 * Complete or uncomplete a task
 * @param {number} userId - Telegram user ID
 * @param {number} taskId - Task ID
 * @returns {Object|null} The updated task or null if not found
 */
function toggleTaskComplete(userId, taskId) {
  initializeUserData(userId);
  const userData = userStore.get(userId);
  
  const taskIndex = userData.tasks.findIndex(t => t.id === taskId);
  if (taskIndex === -1) {
    return null;
  }
  
  // Toggle completion status
  userData.tasks[taskIndex].completed = !userData.tasks[taskIndex].completed;
  
  // Update completed tasks count in stats
  if (userData.tasks[taskIndex].completed) {
    userData.stats.totalCompletedTasks++;
  } else {
    userData.stats.totalCompletedTasks = Math.max(0, userData.stats.totalCompletedTasks - 1);
  }
  
  userStore.set(userId, userData);
  
  return userData.tasks[taskIndex];
}

/**
 * Delete a task
 * @param {number} userId - Telegram user ID
 * @param {number} taskId - Task ID
 * @returns {boolean} True if task was deleted, false if not found
 */
function deleteUserTask(userId, taskId) {
  initializeUserData(userId);
  const userData = userStore.get(userId);
  
  const taskIndex = userData.tasks.findIndex(t => t.id === taskId);
  if (taskIndex === -1) {
    return false;
  }
  
  // If task was completed, reduce completed count
  if (userData.tasks[taskIndex].completed) {
    userData.stats.totalCompletedTasks = Math.max(0, userData.stats.totalCompletedTasks - 1);
  }
  
  // Remove task
  userData.tasks.splice(taskIndex, 1);
  userStore.set(userId, userData);
  
  return true;
}

/**
 * Get user statistics
 * @param {number} userId - Telegram user ID
 * @returns {Object} User statistics
 */
function getUserStats(userId) {
  initializeUserData(userId);
  return userStore.get(userId).stats;
}

/**
 * Update user statistics
 * @param {number} userId - Telegram user ID
 * @param {Object} statsData - Statistics data to update
 */
function updateUserStats(userId, statsData) {
  initializeUserData(userId);
  const userData = userStore.get(userId);
  userData.stats = { ...userData.stats, ...statsData };
  userStore.set(userId, userData);
}

/**
 * Add completed study session to user stats
 * @param {number} userId - Telegram user ID
 * @param {number} durationMinutes - Study session duration in minutes
 */
function addCompletedSession(userId, durationMinutes) {
  initializeUserData(userId);
  const userData = userStore.get(userId);
  
  // Update total study time
  userData.stats.totalStudyTime += durationMinutes;
  
  // Update total sessions
  userData.stats.totalSessions++;
  
  // Update longest session if applicable
  if (durationMinutes > userData.stats.longestSession) {
    userData.stats.longestSession = durationMinutes;
  }
  
  // Update daily study time
  const today = moment().format('YYYY-MM-DD');
  const dailyStudyTime = userData.stats.dailyStudyTime || {};
  dailyStudyTime[today] = (dailyStudyTime[today] || 0) + durationMinutes;
  userData.stats.dailyStudyTime = dailyStudyTime;
  
  // Update streak
  const lastStudyDate = userData.stats.lastStudyDate 
    ? moment(userData.stats.lastStudyDate).format('YYYY-MM-DD')
    : null;
    
  if (lastStudyDate) {
    // If last study date was yesterday, increment streak
    if (moment(today).diff(moment(lastStudyDate), 'days') === 1) {
      userData.stats.streak++;
    } 
    // If last study date was today, keep streak
    else if (today === lastStudyDate) {
      // Streak stays the same
    } 
    // If there was a gap, reset streak to 1
    else {
      userData.stats.streak = 1;
    }
  } else {
    // First time studying
    userData.stats.streak = 1;
  }
  
  // Update last study date
  userData.stats.lastStudyDate = new Date();
  
  userStore.set(userId, userData);
}

// Store active timers for cleanup
const timerStore = new Map();

/**
 * Store active timer for later cleanup
 * @param {number} userId - Telegram user ID
 * @param {string} timerType - Type of timer (study or break)
 * @param {Object} timer - Timer object
 */
function storeTimer(userId, timerType, timer) {
  if (!timerStore.has(userId)) {
    timerStore.set(userId, {});
  }
  
  const userTimers = timerStore.get(userId);
  userTimers[timerType] = timer;
  timerStore.set(userId, userTimers);
}

/**
 * Remove a timer
 * @param {number} userId - Telegram user ID
 * @param {string} timerType - Type of timer (study or break)
 */
function removeTimer(userId, timerType) {
  if (!timerStore.has(userId)) {
    return;
  }
  
  const userTimers = timerStore.get(userId);
  if (userTimers[timerType]) {
    delete userTimers[timerType];
    timerStore.set(userId, userTimers);
  }
}

/**
 * Get all active timers for cleanup
 * @returns {Map} Map of active timers
 */
function getAllActiveTimers() {
  return timerStore;
}

//======================================
// ANIMATION UTILITIES
//======================================

/**
 * Generate an animated progress bar with gradients
 * @param {number} percent - Progress percentage (0-100)
 * @param {number} length - Length of the progress bar
 * @returns {string} Formatted progress bar with gradient colors
 */
function generateAnimatedProgressBar(percent, length = 20) {
  // Calculate filled and empty portions
  const filledLength = Math.floor((percent / 100) * length);
  const emptyLength = length - filledLength;
  
  // Create gradient effect using different characters
  let progressBar = '';
  
  // Different fill characters for a gradient effect
  const fillChars = ['█', '█', '█', '█', '▓'];
  
  // Choose different characters for different segments to create animation effect
  for (let i = 0; i < filledLength; i++) {
    // Determine which character to use based on position for gradient effect
    let charIndex;
    if (i < filledLength * 0.2) {
      charIndex = 0; // Start of bar
    } else if (i < filledLength * 0.4) {
      charIndex = 1; 
    } else if (i < filledLength * 0.6) {
      charIndex = 2;
    } else if (i < filledLength * 0.8) {
      charIndex = 3;
    } else {
      charIndex = 4; // End of bar (gradient effect)
    }
    progressBar += fillChars[charIndex];
  }
  
  // Add empty portion
  progressBar += '░'.repeat(emptyLength);
  
  return progressBar;
}

/**
 * Generate motivational messages for study sessions
 * @returns {string} Random motivational message
 */
function getRandomMotivationalMessage() {
  const messages = [
    "Stay focused! Your future self will thank you. 💫",
    "Every minute of focused study counts! 🚀",
    "Small steps lead to big achievements. Keep going! 👣",
    "Your determination today shapes your success tomorrow. ✨",
    "Learning is a superpower. You're getting stronger! 💪",
    "Focus on progress, not perfection. You're doing great! 🌱",
    "Consistency is key to mastery. Keep up the good work! 🔑",
    "Your potential is unlimited. Keep exploring! 🌍",
    "Deep focus leads to deep understanding. Stay in the zone! 🧠",
    "Remember why you started. Your goals are worth it! 🎯"
  ];
  
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Generate study milestone celebrations
 * @param {number} percent - Progress percentage (0-100)
 * @returns {string|null} Milestone message or null if no milestone reached
 */
function getMilestoneMessage(percent) {
  if (percent === 25) {
    return "🌟 *25% Complete!* You're off to a great start!";
  } else if (percent === 50) {
    return "🔥 *Halfway there!* Keep up the momentum!";
  } else if (percent === 75) {
    return "💎 *75% Complete!* The finish line is in sight!";
  } else if (percent === 100) {
    return "🏆 *Session complete!* Excellent work!";
  }
  
  return null;
}

/**
 * Generate themed progress indicators for different study session types
 * @param {string} theme - Theme name (focus, reading, writing, etc.)
 * @param {number} percent - Progress percentage (0-100)
 * @returns {string} Themed progress indicator
 */
function getThemedProgress(theme, percent) {
  switch (theme.toLowerCase()) {
    case 'reading':
      // Book reading progress (📖 → 📚)
      return `📖 ${'📄'.repeat(Math.floor(percent / 20))}${percent}%`;
    case 'writing':
      // Writing progress (✏️ → 📝)
      return `✏️ ${'📝'.repeat(Math.floor(percent / 20))}${percent}%`;
    case 'coding':
      // Coding progress (💻 → 🚀)
      return `💻 ${'⌨️'.repeat(Math.floor(percent / 20))}${percent}%`;
    case 'math':
      // Math progress (🔢 → 🧮)
      return `🔢 ${'🧮'.repeat(Math.floor(percent / 20))}${percent}%`;
    case 'language':
      // Language learning progress (🗣️ → 🌍)
      return `🗣️ ${'🌍'.repeat(Math.floor(percent / 20))}${percent}%`;
    default:
      // Default focus theme
      return `⏱️ ${'⚡'.repeat(Math.floor(percent / 20))}${percent}%`;
  }
}

//======================================
// TIME UTILITIES
//======================================

/**
 * Format milliseconds into a human-readable time string
 * @param {number} milliseconds - Time in milliseconds
 * @returns {string} Formatted time string (HH:MM:SS)
 */
function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  return `${hours > 0 ? padZero(hours) + ':' : ''}${padZero(minutes)}:${padZero(seconds)}`;
}

/**
 * Add leading zero to numbers less than 10
 * @param {number} num - Number to pad
 * @returns {string} Padded number string
 */
function padZero(num) {
  return num < 10 ? `0${num}` : `${num}`;
}

/**
 * Get duration options for predefined focus times
 * @returns {Array} Array of duration options in minutes
 */
function getFocusDurationOptions() {
  return [25, 45, 60, 90, 120];
}

/**
 * Parse duration string into minutes
 * @param {string} durationStr - Duration string (e.g., "25m", "1h", "1h30m")
 * @returns {number} Duration in minutes or null if invalid
 */
function parseDuration(durationStr) {
  // Handle direct minute specification (e.g., "25")
  if (/^\d+$/.test(durationStr)) {
    return parseInt(durationStr, 10);
  }
  
  // Handle "XXm" format (e.g., "25m")
  const minutesMatch = durationStr.match(/^(\d+)m$/i);
  if (minutesMatch) {
    return parseInt(minutesMatch[1], 10);
  }
  
  // Handle "XXh" format (e.g., "1h")
  const hoursMatch = durationStr.match(/^(\d+)h$/i);
  if (hoursMatch) {
    return parseInt(hoursMatch[1], 10) * 60;
  }
  
  // Handle "XXhYYm" format (e.g., "1h30m")
  const combinedMatch = durationStr.match(/^(\d+)h(\d+)m$/i);
  if (combinedMatch) {
    return parseInt(combinedMatch[1], 10) * 60 + parseInt(combinedMatch[2], 10);
  }
  
  return null; // Invalid format
}

//======================================
// KEYBOARD LAYOUTS
//======================================

/**
 * Create the main keyboard for the bot
 * @returns {Object} Keyboard markup
 */
function mainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        ['🕒 25m Focus', '⏱ 45m Focus'],
        ['⚙️ Custom Timer', '⏰ 60m Focus'],
        ['📋 Tasks', '📊 Stats'],
        ['ℹ️ Help']
      ],
      resize_keyboard: true
    }
  };
}

/**
 * Create the timer keyboard for the bot
 * @param {boolean} isPaused - Whether the timer is currently paused
 * @returns {Object} Keyboard markup
 */
function timerKeyboard(isPaused = false) {
  return {
    inline_keyboard: [
      [
        isPaused 
          ? { text: '▶️ Resume', callback_data: 'resume_focus' }
          : { text: '⏸ Pause', callback_data: 'pause_focus' }
      ],
      [
        { text: '⏹ Stop', callback_data: 'stop_focus' }
      ]
    ]
  };
}

/**
 * Create the task management keyboard
 * @param {Array} tasks - Array of user tasks
 * @returns {Object} Keyboard markup
 */
function taskKeyboard(tasks) {
  const keyboard = [];
  
  // Create buttons for each task (up to 5)
  const tasksToShow = tasks.slice(0, 5);
  
  for (const task of tasksToShow) {
    const status = task.completed ? '✅' : '⬜';
    const row = [
      { 
        text: `${status} ${task.id}. ${task.text.substring(0, 20)}${task.text.length > 20 ? '...' : ''}`,
        callback_data: `complete_task_${task.id}`
      },
      {
        text: '🗑️',
        callback_data: `delete_task_${task.id}`
      }
    ];
    keyboard.push(row);
  }
  
  // Add button to view all tasks if there are more than 5
  if (tasks.length > 5) {
    keyboard.push([
      { text: 'View all tasks', callback_data: 'view_all_tasks' }
    ]);
  }
  
  return {
    inline_keyboard: keyboard
  };
}

//======================================
// TIMER SERVICE
//======================================

/**
 * Start a focus timer for a user
 * @param {number} chatId - Telegram chat ID (same as user ID in private chats)
 * @param {number} duration - Timer duration in minutes
 * @returns {Object} Timer message info
 */
async function startFocusTimer(chatId, duration) {
  try {
    // Validate input parameters
    if (!chatId || !duration || duration <= 0) {
      console.error('Invalid parameters for startFocusTimer:', { chatId, duration });
      throw new Error('Invalid timer parameters');
    }
    
    // Clear any existing timers for this user
    stopFocusTimer(chatId);
    
    const session = getUserSession(chatId);
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + duration * 60000);
    
    // Let user know the timer is starting
    try {
      await bot.sendMessage(
        chatId,
        `⏳ *Starting a ${duration}-minute focus session...*`,
        { parse_mode: 'Markdown' }
      );
    } catch (notifyError) {
      console.log('Error sending start notification:', notifyError.message);
      // Continue even if this message fails
    }
    
    // Update user session
    updateUserSession(chatId, {
      isStudying: true,
      studyStartTime: startTime,
      pauseStartTime: null,
      totalPausedTime: 0,
      pausedDuration: 0,
      plannedDuration: duration
    });
    
    // Send initial timer message with advanced animation
    const timerMessage = await bot.sendMessage(
      chatId,
      generateTimerMessage(startTime, endTime, 0),
      {
        parse_mode: 'Markdown',
        reply_markup: timerKeyboard()
      }
    );
    
    // Store message ID for updates
    updateUserSession(chatId, { messageId: timerMessage.message_id });
    
    // Schedule timer updates every minute
    const updateJob = scheduleTimerUpdates(chatId, startTime, endTime);
    
    // Schedule job for when timer completes
    const endJob = schedule.scheduleJob(endTime, () => {
      handleTimerComplete(chatId, duration).catch(error => {
        console.error('Error in timer completion handler:', error);
      });
    });
    
    // Store timers for cleanup
    storeTimer(chatId, 'update', updateJob);
    storeTimer(chatId, 'end', endJob);
    
    // Select motivational message for starting the session
    const motivationalStart = [
      "🧠 Focus mode activated! Let's make this time count.",
      "🚀 Your study journey begins now. Stay focused!",
      "💡 Time to sharpen your mind. You've got this!",
      "⌛ Every minute of focus builds your future.",
      "🔥 Your dedication today leads to success tomorrow."
    ];
    
    // Send a starter motivational message
    try {
      await bot.sendMessage(
        chatId,
        motivationalStart[Math.floor(Math.random() * motivationalStart.length)],
        { parse_mode: 'Markdown' }
      );
    } catch (motivationalError) {
      console.log('Error sending motivational message:', motivationalError.message);
      // Continue execution even if this fails
    }
    
    return {
      messageId: timerMessage.message_id,
      startTime,
      endTime
    };
  } catch (error) {
    console.error('Error starting focus timer:', error.message);
    
    // Try to notify the user of the error
    try {
      await bot.sendMessage(
        chatId,
        `⚠️ *Timer Error*\n\nThere was a problem starting your focus timer. Please try again by sending /focus command.`,
        { parse_mode: 'Markdown' }
      );
    } catch (notifyError) {
      console.error('Error sending error notification:', notifyError.message);
    }
    
    throw error; // Re-throw for higher-level handling
  }
}

/**
 * Schedule timer updates every minute
 * @param {number} chatId - Telegram chat ID
 * @param {Date} startTime - Timer start time
 * @param {Date} endTime - Timer end time
 * @returns {Object} Scheduled job
 */
function scheduleTimerUpdates(chatId, startTime, endTime) {
  // Update every minute
  return schedule.scheduleJob('*/1 * * * *', async () => {
    const session = getUserSession(chatId);
    
    // Skip updates if timer is paused
    if (session.pauseStartTime) {
      return;
    }
    
    // Calculate elapsed time considering pauses
    const now = new Date();
    const elapsedTimeWithPauses = now - startTime - session.totalPausedTime;
    
    // Only update if still studying and message ID exists
    if (session.isStudying && session.messageId) {
      try {
        await bot.editMessageText(
          generateTimerMessage(startTime, endTime, session.totalPausedTime),
          {
            chat_id: chatId,
            message_id: session.messageId,
            parse_mode: 'Markdown',
            reply_markup: timerKeyboard(session.pauseStartTime !== null)
          }
        );
      } catch (error) {
        console.error('Error updating timer message:', error.message);
      }
    }
  });
}

/**
 * Generate timer message with current progress
 * @param {Date} startTime - Timer start time
 * @param {Date} endTime - Timer end time
 * @param {number} pausedTime - Total paused time in milliseconds
 * @returns {string} Formatted timer message
 */
function generateTimerMessage(startTime, endTime, pausedTime) {
  const now = new Date();
  
  // Adjust for paused time
  const adjustedNow = new Date(now.getTime() - pausedTime);
  const remainingTime = endTime - adjustedNow;
  
  // Don't show negative time if timer already ended
  const remaining = Math.max(0, remainingTime);
  
  // Format the time remaining
  const remainingFormatted = formatTime(remaining);
  
  // Calculate progress percentage
  const totalDuration = endTime - startTime;
  const elapsed = now - startTime - pausedTime;
  const progressPercent = Math.min(100, Math.max(0, Math.floor((elapsed / totalDuration) * 100)));
  
  // Create animated progress bar with gradient effect
  const progressBar = generateAnimatedProgressBar(progressPercent, 20);
  
  // Check if we've hit a milestone
  const milestone = getMilestoneMessage(progressPercent);
  const milestoneText = milestone ? `\n${milestone}\n` : '';
  
  // Get a random motivational message
  const motivationalMessage = getRandomMotivationalMessage();
  
  return `*Study Focus Timer*\n\n` +
         `⏱ Time Remaining: *${remainingFormatted}*\n` +
         `Progress: ${progressPercent}%\n` +
         `${progressBar}${milestoneText}\n` +
         `${motivationalMessage}\n` +
         `Use /stop to end session early`;
}

/**
 * Handle timer completion
 * @param {number} chatId - Telegram chat ID
 * @param {number} duration - Timer duration in minutes
 */
async function handleTimerComplete(chatId, duration) {
  try {
    const session = getUserSession(chatId);
    
    // Only proceed if user is still studying
    if (!session.isStudying) {
      return;
    }
    
    // Calculate actual study time (accounting for pauses)
    const actualDuration = session.pausedDuration > 0
      ? duration - (session.pausedDuration / 60)
      : duration;
    
    // Update stats
    addCompletedSession(chatId, Math.round(actualDuration));
    
    // Cleanup the timer and session
    stopFocusTimer(chatId);
    
    // Create a visual reward/achievement display
    const studyStars = '⭐'.repeat(Math.min(5, Math.ceil(actualDuration / 10))); // Stars based on study time
    
    // Select achievement badge based on session duration
    let achievementBadge;
    if (duration >= 90) {
      achievementBadge = '🏆'; // Trophy for long sessions
    } else if (duration >= 45) {
      achievementBadge = '🥇'; // Gold medal for medium sessions
    } else if (duration >= 25) {
      achievementBadge = '🥈'; // Silver medal for standard sessions
    } else {
      achievementBadge = '🥉'; // Bronze medal for short sessions
    }
    
    // Create a decorative border
    const border = '┏' + '━'.repeat(30) + '┓\n';
    const borderEnd = '┗' + '━'.repeat(30) + '┛';
    
    // Calculate streaks and other stats
    const stats = getUserSession(chatId).stats || {};
    const streak = stats.streak || 1;
    const streakText = streak > 1 ? `\n🔥 *Day streak: ${streak}*` : '';
    
    // Generate motivational quote based on session duration
    let quote = '';
    if (duration >= 60) {
      quote = "Deep work leads to deep insights. Well done! 🧠";
    } else if (duration >= 30) {
      quote = "Consistency is the key to mastery. Keep it up! 🔑";
    } else {
      quote = "Small steps lead to big achievements! 👣";
    }
    
    // First send the notification sound
    // We use the telegram built-in notification sound feature
    try {
      // Send a notification sound using Telegram's voice message
      await bot.sendVoice(chatId, 'https://raw.githubusercontent.com/mattiabasone/TelegramBotPHP/master/tests/fixtures/voice.ogg', {
        caption: '🔔 Your focus session is complete!',
        disable_notification: false // Ensure notification sound plays
      });
    } catch (soundError) {
      console.log('Error sending sound notification:', soundError.message);
      // Continue execution even if sound fails
    }
    
    // Wait a moment before sending the completion message
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Congratulate the user with enhanced visual display
    await bot.sendMessage(
      chatId,
      `${border}` +
      `       ${achievementBadge} *SESSION COMPLETE* ${achievementBadge}\n\n` +
      `🎉 *Congratulations!* 🎉\n` +
      `You've completed your ${duration}-minute study session!\n\n` +
      `⏱ Actual study time: *${Math.round(actualDuration)}* minutes\n` +
      `${studyStars}${streakText}\n\n` +
      `${quote}\n` +
      `Take a well-deserved break and when you're ready, start another session with /focus.\n` +
      `${borderEnd}`,
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 25-min session', callback_data: 'focus_25' }],
            [{ text: '🕒 45-min session', callback_data: 'focus_45' }],
            [{ text: '⏱ 60-min session', callback_data: 'focus_60' }],
            [{ text: '📊 View my stats', callback_data: 'stats' }],
            [{ text: '⚙️ Custom timer', callback_data: 'focus_custom' }]
          ]
        }
      }
    );
    
    // Schedule a break reminder after 5 minutes
    const breakEndTime = new Date(new Date().getTime() + 5 * 60000);
    const breakReminder = schedule.scheduleJob(breakEndTime, async () => {
      try {
        // Try to send notification sound for break end
        try {
          await bot.sendVoice(chatId, 'https://raw.githubusercontent.com/mattiabasone/TelegramBotPHP/master/tests/fixtures/voice.ogg', {
            caption: '⏰ Break time is over!',
            disable_notification: false
          });
        } catch (breakSoundError) {
          console.log('Error sending break sound notification:', breakSoundError.message);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Create a decorative message for break end
        const breakBorder = '┏' + '━'.repeat(25) + '┓\n';
        const breakBorderEnd = '┗' + '━'.repeat(25) + '┛';
        
        await bot.sendMessage(
          chatId,
          `${breakBorder}` +
          `     ⏰ *BREAK COMPLETE* ⏰\n\n` +
          `Your break time is over!\n` +
          `Ready for another productive\n` +
          `study session? 💡\n\n` +
          `Use /focus to start a new timer.\n` +
          `${breakBorderEnd}`,
          { 
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🔄 25-min session', callback_data: 'focus_25' },
                  { text: '🕒 45-min session', callback_data: 'focus_45' }
                ],
                [
                  { text: '⏱ 60-min session', callback_data: 'focus_60' },
                  { text: '⚙️ Custom timer', callback_data: 'focus_custom' }
                ],
                [
                  { text: '📋 View tasks', callback_data: 'tasks' }
                ]
              ]
            }
          }
        );
      } catch (error) {
        console.error('Error sending break completion message:', error.message);
      } finally {
        removeTimer(chatId, 'break');
      }
    });
    
    storeTimer(chatId, 'break', breakReminder);
  } catch (error) {
    console.error('Error in handleTimerComplete:', error.message);
    
    // Try to send a simple message in case of error
    try {
      await bot.sendMessage(
        chatId,
        "✅ Your focus session is complete! Great job!",
        { parse_mode: 'Markdown' }
      );
    } catch (msgError) {
      console.error('Error sending fallback message:', msgError.message);
    }
  }
}

/**
 * Stop ongoing focus timer
 * @param {number} chatId - Telegram chat ID
 */
function stopFocusTimer(chatId) {
  const session = getUserSession(chatId);
  
  // Cancel any scheduled jobs
  const timers = getAllActiveTimers().get(chatId) || {};
  
  if (timers.update) {
    timers.update.cancel();
    removeTimer(chatId, 'update');
  }
  
  if (timers.end) {
    timers.end.cancel();
    removeTimer(chatId, 'end');
  }
  
  // Calculate study duration for stats if timer was running
  if (session.isStudying && session.studyStartTime) {
    const endTime = new Date();
    let studyDuration = (endTime - session.studyStartTime - session.totalPausedTime) / 60000; // in minutes
    
    // Only add to stats if more than a minute was studied
    if (studyDuration > 1) {
      addCompletedSession(chatId, Math.round(studyDuration));
    }
  }
  
  // Reset session
  updateUserSession(chatId, {
    isStudying: false,
    studyStartTime: null,
    pauseStartTime: null,
    totalPausedTime: 0,
    pausedDuration: 0,
    messageId: null
  });
}

/**
 * Pause ongoing focus timer
 * @param {number} chatId - Telegram chat ID
 * @returns {boolean} True if timer was paused, false if no active timer
 */
async function pauseFocusTimer(chatId) {
  const session = getUserSession(chatId);
  
  if (!session.isStudying || session.pauseStartTime) {
    return false;
  }
  
  // Set pause start time
  updateUserSession(chatId, {
    pauseStartTime: new Date()
  });
  
  // Update timer message
  if (session.messageId) {
    try {
      await bot.editMessageReplyMarkup(
        timerKeyboard(true),
        {
          chat_id: chatId,
          message_id: session.messageId
        }
      );
    } catch (error) {
      console.error('Error updating keyboard:', error.message);
    }
  }
  
  return true;
}

/**
 * Resume paused focus timer
 * @param {number} chatId - Telegram chat ID
 * @returns {boolean} True if timer was resumed, false if no paused timer
 */
async function resumeFocusTimer(chatId) {
  const session = getUserSession(chatId);
  
  if (!session.isStudying || !session.pauseStartTime) {
    return false;
  }
  
  // Calculate pause duration
  const now = new Date();
  const pauseDuration = now - session.pauseStartTime;
  
  // Update total paused time and pause duration in minutes
  updateUserSession(chatId, {
    pauseStartTime: null,
    totalPausedTime: session.totalPausedTime + pauseDuration,
    pausedDuration: session.pausedDuration + (pauseDuration / 60000)
  });
  
  // Update timer message
  if (session.messageId) {
    try {
      await bot.editMessageReplyMarkup(
        timerKeyboard(false),
        {
          chat_id: chatId,
          message_id: session.messageId
        }
      );
    } catch (error) {
      console.error('Error updating keyboard:', error.message);
    }
  }
  
  return true;
}

/**
 * Cleanup stale timers
 */
function cleanupTimers() {
  const allTimers = getAllActiveTimers();
  
  for (const [userId, timers] of allTimers.entries()) {
    const session = getUserSession(parseInt(userId));
    
    // If user isn't studying but has active timers, clean them up
    if (!session.isStudying) {
      for (const timerType in timers) {
        timers[timerType].cancel();
        removeTimer(parseInt(userId), timerType);
      }
    }
  }
}

//======================================
// TASK SERVICE
//======================================

/**
 * Get all tasks for a user
 * @param {number} userId - Telegram user ID
 * @returns {Array} Array of tasks
 */
function getUserTaskList(userId) {
  return getUserTasks(userId);
}

/**
 * Create a new task for user
 * @param {number} userId - Telegram user ID
 * @param {string} taskText - Task description
 * @returns {Object} The created task
 */
function createTask(userId, taskText) {
  return addUserTask(userId, taskText);
}

/**
 * Mark a task as complete or incomplete
 * @param {number} userId - Telegram user ID
 * @param {number} taskId - Task ID
 * @returns {Object|null} Updated task or null if not found
 */
function toggleTaskCompletion(userId, taskId) {
  return toggleTaskComplete(userId, parseInt(taskId));
}

/**
 * Remove a task
 * @param {number} userId - Telegram user ID
 * @param {number} taskId - Task ID
 * @returns {boolean} True if task was deleted
 */
function removeTask(userId, taskId) {
  return deleteUserTask(userId, parseInt(taskId));
}

/**
 * Format tasks list as a message
 * @param {Array} tasks - Array of tasks
 * @returns {string} Formatted message
 */
function formatTasksMessage(tasks) {
  // Create decorative border
  const border = '┏' + '━'.repeat(28) + '┓\n';
  const borderEnd = '┗' + '━'.repeat(28) + '┛';
  
  if (tasks.length === 0) {
    return `${border}` +
           `       📋 *TASK LIST* 📋\n\n` +
           `No tasks found! 🔍\n\n` +
           `Add new tasks with:\n` +
           `/addtask [task description]\n` +
           `${borderEnd}`;
  }
  
  // Get pending and completed tasks
  const pendingTasks = tasks.filter(task => !task.completed);
  const completedTasks = tasks.filter(task => task.completed);
  
  // Format tasks with categorization and priority indicators
  const formatTask = (task, index) => {
    // Choose emoji based on importance (using position in the list as a simple proxy)
    let priorityEmoji = task.completed ? '✅' : '⬜';
    
    // For pending tasks, add visual priority indicators
    if (!task.completed) {
      if (index === 0) priorityEmoji = '🔴'; // Highest priority
      else if (index === 1) priorityEmoji = '🟠'; // High priority
      else if (index === 2) priorityEmoji = '🟡'; // Medium priority
      else priorityEmoji = '🟢'; // Lower priority
    }
    
    // Add visual indicator for task age (assuming newer tasks at the bottom)
    const ageIndicator = task.completed ? '' : (
      index < pendingTasks.length / 3 ? '⚡' : ''
    );
    
    return `${priorityEmoji} *${task.id}.* ${task.text} ${ageIndicator}`;
  };
  
  // Format task lists
  const pendingTasksList = pendingTasks.map((task, i) => formatTask(task, i)).join('\n');
  const completedTasksList = completedTasks.length > 0 
    ? `\n*✓ Completed Tasks*\n` + completedTasks.map((task, i) => formatTask(task, i)).join('\n')
    : '';
  
  // Count completed tasks and generate progress bar
  const completedCount = completedTasks.length;
  const progress = tasks.length > 0 
    ? Math.round((completedCount / tasks.length) * 100) 
    : 0;
  
  // Create progress bar
  const progressBarLength = 20;
  const filledLength = Math.round((progress / 100) * progressBarLength);
  const progressBar = '█'.repeat(filledLength) + '░'.repeat(progressBarLength - filledLength);
  
  // Status message based on progress
  let statusMessage = '';
  if (progress === 100) {
    statusMessage = '🎉 All tasks complete! Great job!';
  } else if (progress >= 75) {
    statusMessage = '🚀 Almost there! Keep going!';
  } else if (progress >= 50) {
    statusMessage = '💪 Good progress! Half way there!';
  } else if (progress >= 25) {
    statusMessage = '👍 Making progress! Keep it up!';
  } else {
    statusMessage = '🏁 Let\'s start checking off those tasks!';
  }
  
  return `${border}` +
         `       📋 *TASK LIST* 📋\n\n` +
         `*⏳ Pending Tasks (${pendingTasks.length})*\n` +
         `${pendingTasksList}\n` +
         `${completedTasksList}\n\n` +
         `*Progress: ${progress}%*\n` +
         `${progressBar}\n` +
         `${statusMessage}\n\n` +
         `*Commands:*\n` +
         `• /addtask [description] - Add task\n` +
         `• /complete [ID] - Mark complete\n` +
         `• /delete [ID] - Delete task\n` +
         `${borderEnd}`;
}

//======================================
// STATS SERVICE
//======================================

/**
 * Get formatted statistics for a user
 * @param {number} userId - Telegram user ID
 * @returns {string} Formatted statistics message
 */
function getFormattedStats(userId) {
  const stats = getUserStats(userId);
  
  // Format total study time
  const totalHours = Math.floor(stats.totalStudyTime / 60);
  const totalMinutes = stats.totalStudyTime % 60;
  const totalTimeFormatted = totalHours > 0 
    ? `${totalHours}h ${totalMinutes}m` 
    : `${totalMinutes}m`;
  
  // Format average session time
  const avgSessionTime = stats.totalSessions > 0 
    ? Math.round(stats.totalStudyTime / stats.totalSessions) 
    : 0;
  const avgTimeFormatted = `${avgSessionTime}m`;
  
  // Get study time for last 7 days
  const dailyStats = getDailyStudyStats(stats.dailyStudyTime, 7);
  const weeklyTotal = dailyStats.reduce((sum, day) => sum + day.minutes, 0);
  
  // Format daily study chart
  const chart = generateStudyChart(dailyStats);
  
  // Generate achievement indicators based on stats
  const achievements = generateAchievements(stats);
  
  // Create a decorative border
  const border = '┏' + '━'.repeat(30) + '┓\n';
  const borderEnd = '┗' + '━'.repeat(30) + '┛';
  
  // Calculate productivity score (0-100)
  const productivityScore = calculateProductivityScore(stats, dailyStats);
  const productivityBar = generateProductivityBar(productivityScore);
  
  // Generate streak information
  const streakInfo = stats.streak > 1 
    ? `\n🔥 *Current Streak: ${stats.streak} days*` 
    : '';
  
  return `${border}` +
         `        📊 *STUDY STATISTICS* 📊\n\n` +
         `⏱ Total study time: *${totalTimeFormatted}*\n` +
         `🔄 Completed sessions: *${stats.totalSessions}*\n` +
         `⌛ Average session: *${avgTimeFormatted}*\n` +
         `✅ Completed tasks: *${stats.totalCompletedTasks}*${streakInfo}\n\n` +
         `🏆 *Productivity Score:* ${productivityScore}/100\n` +
         `${productivityBar}\n\n` +
         `${achievements}\n` +
         `*Last 7 Days Activity*\n` +
         `Total: ${weeklyTotal}m\n${chart}\n` +
         `${borderEnd}`;
}

/**
 * Calculate a productivity score based on user's stats
 * @param {Object} stats - User statistics
 * @param {Array} dailyStats - Daily study statistics
 * @returns {number} Productivity score (0-100)
 */
function calculateProductivityScore(stats, dailyStats) {
  // Define maximum values for scoring
  const maxDailyTime = 120; // 2 hours daily is considered maximum
  const maxStreak = 7; // 7-day streak is max score
  const maxSessions = 30; // 30 completed sessions is max
  const maxCompletedTasks = 50; // 50 completed tasks is max
  
  // Calculate scores for different aspects (0-25 each)
  let activeScore = 0;
  let streakScore = 0;
  let sessionScore = 0;
  let taskScore = 0;
  
  // Activity score: Based on average daily study time over the past week
  const weeklyAvg = dailyStats.reduce((sum, day) => sum + day.minutes, 0) / 7;
  activeScore = Math.min(25, Math.round((weeklyAvg / maxDailyTime) * 25));
  
  // Streak score: Based on current streak
  streakScore = Math.min(25, Math.round((stats.streak / maxStreak) * 25));
  
  // Session score: Based on total completed sessions
  sessionScore = Math.min(25, Math.round((stats.totalSessions / maxSessions) * 25));
  
  // Task score: Based on completed tasks
  taskScore = Math.min(25, Math.round((stats.totalCompletedTasks / maxCompletedTasks) * 25));
  
  return activeScore + streakScore + sessionScore + taskScore;
}

/**
 * Generate a visual bar representing productivity score
 * @param {number} score - Productivity score (0-100)
 * @returns {string} Visual progress bar
 */
function generateProductivityBar(score) {
  const totalLength = 20;
  const filledLength = Math.round((score / 100) * totalLength);
  
  // Use different characters for different score ranges
  let barChar = '█';
  if (score >= 80) barChar = '█'; // High score
  else if (score >= 50) barChar = '▓'; // Medium score
  else if (score >= 20) barChar = '▒'; // Low score
  else barChar = '░'; // Very low score
  
  return barChar.repeat(filledLength) + '░'.repeat(totalLength - filledLength);
}

/**
 * Generate achievement text based on user stats
 * @param {Object} stats - User statistics
 * @returns {string} Achievement text
 */
function generateAchievements(stats) {
  const achievements = [];
  
  // Study time achievements
  if (stats.totalStudyTime >= 600) { // 10+ hours
    achievements.push('🥇 *Master Scholar*');
  } else if (stats.totalStudyTime >= 300) { // 5+ hours
    achievements.push('🥈 *Dedicated Student*');
  } else if (stats.totalStudyTime >= 60) { // 1+ hour
    achievements.push('🥉 *Study Starter*');
  }
  
  // Session achievements
  if (stats.totalSessions >= 20) {
    achievements.push('🏆 *Session Champion*');
  } else if (stats.totalSessions >= 10) {
    achievements.push('🌟 *Consistent Learner*');
  }
  
  // Streak achievements
  if (stats.streak >= 5) {
    achievements.push('🔥 *Streak Master*');
  } else if (stats.streak >= 3) {
    achievements.push('📆 *Regular Student*');
  }
  
  // Format achievements
  if (achievements.length > 0) {
    return `*Achievements:*\n${achievements.join('\n')}\n\n`;
  }
  return '';
}

/**
 * Get daily study statistics for the specified number of days
 * @param {Object} dailyData - Object with date keys and minute values
 * @param {number} days - Number of days to include
 * @returns {Array} Array of daily stats objects
 */
function getDailyStudyStats(dailyData, days) {
  const result = [];
  
  // Generate an array of the last N days in YYYY-MM-DD format
  for (let i = days - 1; i >= 0; i--) {
    const date = moment().subtract(i, 'days').format('YYYY-MM-DD');
    const dayName = moment(date).format('ddd');
    
    result.push({
      date,
      dayName,
      minutes: dailyData[date] || 0
    });
  }
  
  return result;
}

/**
 * Generate a text-based chart of daily study time
 * @param {Array} dailyStats - Array of daily stats objects
 * @returns {string} Text-based chart
 */
function generateStudyChart(dailyStats) {
  // Find the maximum study time to scale the chart
  const maxMinutes = Math.max(...dailyStats.map(d => d.minutes), 30); // Minimum of 30 for scale
  
  // Generate chart with gradient bars and indicators
  const chartLines = dailyStats.map(day => {
    // Calculate bar length (max 15 characters)
    const barLength = day.minutes > 0 
      ? Math.max(1, Math.round((day.minutes / maxMinutes) * 15))
      : 0;
    
    // Use different fill characters for a gradient effect based on percentage
    let bar = '';
    const percentOfMax = day.minutes / maxMinutes;
    
    // Choose bar character based on time study
    let barChar = '░'; // Default (empty)
    
    if (percentOfMax >= 0.8) {
      barChar = '█'; // 80-100% fill
    } else if (percentOfMax >= 0.6) {
      barChar = '▓'; // 60-80% fill
    } else if (percentOfMax >= 0.3) {
      barChar = '▒'; // 30-60% fill 
    } else if (percentOfMax > 0) {
      barChar = '░'; // 1-30% fill
    }
    
    bar = barChar.repeat(barLength);
    
    // Add small visual indicators for time categories
    let timeIndicator = '';
    if (day.minutes >= 120) {
      timeIndicator = '🌟'; // 2+ hours
    } else if (day.minutes >= 60) {
      timeIndicator = '⭐'; // 1+ hour 
    } else if (day.minutes >= 30) {
      timeIndicator = '🔆'; // 30+ minutes
    } else if (day.minutes > 0) {
      timeIndicator = '🔅'; // Some study time
    } else {
      timeIndicator = '⚪'; // No study
    }
    
    return `${day.dayName}: ${timeIndicator} ${bar} ${day.minutes}m`;
  });
  
  return chartLines.join('\n');
}

//======================================
// COMMAND HANDLERS
//======================================

/**
 * Handler for the /start command
 * @param {Object} msg - Telegram message object
 */
function handleStartCommand(msg) {
  const chatId = msg.chat.id;
  
  bot.sendMessage(
    chatId,
    `👋 *Welcome to Study Focus Bot!*\n\n` +
    `I'll help you stay focused during your study sessions and track your progress.\n\n` +
    `*Main commands:*\n` +
    `• /focus - Start a focus timer\n` +
    `• /tasks - Manage your tasks\n` +
    `• /stats - View your study statistics\n` +
    `• /help - Show all commands\n\n` +
    `Let's get started by setting up a focus timer or adding some tasks!`,
    {
      parse_mode: 'Markdown',
      ...mainKeyboard()
    }
  );
}

/**
 * Handler for the /help command
 * @param {Object} msg - Telegram message object
 */
function handleHelpCommand(msg) {
  const chatId = msg.chat.id;
  
  bot.sendMessage(
    chatId,
    `*📚 Study Focus Bot Help*\n\n` +
    `*Timer Commands:*\n` +
    `• /focus [minutes] - Start a focus timer (default options: 25, 45, 60 min)\n` +
    `• /stop - Stop the current timer\n` +
    `• /pause - Pause the current timer\n` +
    `• /resume - Resume a paused timer\n\n` +
    `*Task Commands:*\n` +
    `• /tasks - View your task list\n` +
    `• /addtask [description] - Add a new task\n` +
    `• /complete [ID] - Mark a task as complete or incomplete\n` +
    `• /delete [ID] - Delete a task\n\n` +
    `*Statistics:*\n` +
    `• /stats - View your study statistics\n\n` +
    `*Other Commands:*\n` +
    `• /start - Start the bot\n` +
    `• /help - Show this help message`,
    {
      parse_mode: 'Markdown'
    }
  );
}

/**
 * Handler for the /focus command
 * @param {Object} msg - Telegram message object
 * @param {Array} match - Regex match array
 */
async function handleFocusCommand(msg, match) {
  const chatId = msg.chat.id;
  const durationInput = match[1]; // This will capture any text after /focus
  
  if (durationInput) {
    // If duration is provided, try to parse it
    const duration = parseDuration(durationInput);
    
    if (duration && duration > 0 && duration <= 180) { // Limit to 3 hours max
      await startFocusTimer(chatId, duration);
    } else {
      // Create a decorative error message
      const border = '┏' + '━'.repeat(28) + '┓\n';
      const borderEnd = '┗' + '━'.repeat(28) + '┛';
      
      bot.sendMessage(
        chatId,
        `${border}` +
        `     ⚠️ *INVALID DURATION* ⚠️\n\n` +
        `Please specify a valid duration between 5 and 180 minutes.\n\n` +
        `*Valid formats:*\n` +
        `• Minutes only: \`25\`\n` +
        `• Minutes with "m": \`45m\`\n` +
        `• Hours with "h": \`1h\`\n` +
        `• Hours and minutes: \`1h30m\`\n` +
        `${borderEnd}`,
        { parse_mode: 'Markdown' }
      );
    }
  } else {
    // If no duration is provided, show enhanced duration options
    const standardOptions = [
      [
        { text: '🕒 25 min', callback_data: 'focus_25' },
        { text: '⏱ 45 min', callback_data: 'focus_45' },
        { text: '⏰ 60 min', callback_data: 'focus_60' }
      ],
      [
        { text: '📚 Study Session (90 min)', callback_data: 'focus_90' },
        { text: '📖 Deep Work (120 min)', callback_data: 'focus_120' }
      ],
      [
        { text: '⚙️ Custom Durations...', callback_data: 'focus_custom' }
      ],
      [
        { text: '⌨️ Enter Specific Time', callback_data: 'focus_specific' }
      ]
    ];
    
    // Create a decorative border
    const border = '┏' + '━'.repeat(30) + '┓\n';
    const borderEnd = '┗' + '━'.repeat(30) + '┛';
    
    bot.sendMessage(
      chatId,
      `${border}` +
      `       ⏱ *TIMER SELECTION* ⏱\n\n` +
      `Choose how long you want to focus:\n\n` +
      `• Standard options (25, 45, 60 min)\n` +
      `• Longer sessions (90, 120 min)\n` +
      `• Custom durations menu\n` +
      `• Enter a specific time\n` +
      `${borderEnd}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: standardOptions
        }
      }
    );
  }
}

/**
 * Handler for the /stop command
 * @param {Object} msg - Telegram message object
 */
function handleStopFocusCommand(msg) {
  const chatId = msg.chat.id;
  const session = getUserSession(chatId);
  
  if (session.isStudying) {
    stopFocusTimer(chatId);
    bot.sendMessage(
      chatId,
      `⏹ *Timer stopped*\n\n` +
      `Your focus session has been stopped.`,
      {
        parse_mode: 'Markdown',
        ...mainKeyboard()
      }
    );
  } else {
    bot.sendMessage(
      chatId,
      `ℹ️ You don't have an active focus timer.`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Handler for the /pause command
 * @param {Object} msg - Telegram message object
 */
async function handlePauseFocusCommand(msg) {
  const chatId = msg.chat.id;
  
  const paused = await pauseFocusTimer(chatId);
  
  if (paused) {
    bot.sendMessage(
      chatId,
      `⏸ *Timer paused*\n\n` +
      `Your focus session has been paused. Use /resume to continue.`,
      { parse_mode: 'Markdown' }
    );
  } else {
    bot.sendMessage(
      chatId,
      `ℹ️ You don't have an active focus timer or it's already paused.`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Handler for the /resume command
 * @param {Object} msg - Telegram message object
 */
async function handleResumeFocusCommand(msg) {
  const chatId = msg.chat.id;
  
  const resumed = await resumeFocusTimer(chatId);
  
  if (resumed) {
    bot.sendMessage(
      chatId,
      `▶️ *Timer resumed*\n\n` +
      `Your focus session has been resumed.`,
      { parse_mode: 'Markdown' }
    );
  } else {
    bot.sendMessage(
      chatId,
      `ℹ️ You don't have a paused focus timer.`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Handler for focus timer keyboard callback
 * @param {string} callbackQueryId - Callback query ID
 * @param {number} chatId - Chat ID
 * @param {number} duration - Focus duration in minutes
 */
async function handleFocusCallback(callbackQueryId, chatId, duration) {
  bot.answerCallbackQuery(callbackQueryId);
  
  if (duration === 'custom') {
    // Create a more interactive custom timer selection
    const customDurations = [
      [
        { text: '15 min', callback_data: 'focus_15' },
        { text: '20 min', callback_data: 'focus_20' },
        { text: '30 min', callback_data: 'focus_30' }
      ],
      [
        { text: '40 min', callback_data: 'focus_40' },
        { text: '50 min', callback_data: 'focus_50' },
        { text: '70 min', callback_data: 'focus_70' }
      ],
      [
        { text: '80 min', callback_data: 'focus_80' },
        { text: '90 min', callback_data: 'focus_90' },
        { text: '120 min', callback_data: 'focus_120' }
      ],
      [
        { text: 'Specific Duration ⌨️', callback_data: 'focus_specific' }
      ]
    ];
    
    // Send a message with custom duration options
    bot.sendMessage(
      chatId,
      `⏱ *Custom Timer Selection*\n\n` +
      `Choose from additional durations or select "Specific Duration" to enter a precise time:`,
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: customDurations
        }
      }
    );
    return;
  } else if (duration === 'specific') {
    // Set a flag in the user session that they're entering a custom duration
    updateUserSession(chatId, { awaitingCustomDuration: true });
    
    // Create a decorative message
    const border = '┏' + '━'.repeat(30) + '┓\n';
    const borderEnd = '┗' + '━'.repeat(30) + '┛';
    
    bot.sendMessage(
      chatId,
      `${border}` +
      `      ⌨️ *CUSTOM DURATION* ⌨️\n\n` +
      `Please enter your desired study time.\n\n` +
      `*Formats accepted:*\n` +
      `• Minutes only: \`35\`\n` +
      `• Minutes with "m": \`35m\`\n` +
      `• Hours with "h": \`1h\`\n` +
      `• Hours and minutes: \`1h20m\`\n\n` +
      `*Limits:* 5-180 minutes\n` +
      `${borderEnd}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  await startFocusTimer(chatId, parseInt(duration));
}

/**
 * Handler for stop focus callback
 * @param {string} callbackQueryId - Callback query ID
 * @param {number} chatId - Chat ID
 */
async function handleStopFocusCallback(callbackQueryId, chatId) {
  bot.answerCallbackQuery(callbackQueryId);
  
  stopFocusTimer(chatId);
  
  bot.sendMessage(
    chatId,
    `⏹ *Timer stopped*\n\n` +
    `Your focus session has been stopped.`,
    {
      parse_mode: 'Markdown',
      ...mainKeyboard()
    }
  );
}

/**
 * Handler for pause focus callback
 * @param {string} callbackQueryId - Callback query ID
 * @param {number} chatId - Chat ID
 */
async function handlePauseFocusCallback(callbackQueryId, chatId) {
  bot.answerCallbackQuery(callbackQueryId);
  
  const paused = await pauseFocusTimer(chatId);
  
  if (!paused) {
    bot.sendMessage(
      chatId,
      `ℹ️ Unable to pause. Your timer may already be paused.`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Handler for resume focus callback
 * @param {string} callbackQueryId - Callback query ID
 * @param {number} chatId - Chat ID
 */
async function handleResumeFocusCallback(callbackQueryId, chatId) {
  bot.answerCallbackQuery(callbackQueryId);
  
  const resumed = await resumeFocusTimer(chatId);
  
  if (!resumed) {
    bot.sendMessage(
      chatId,
      `ℹ️ Unable to resume. You may not have a paused timer.`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Handler for the /tasks command
 * @param {Object} msg - Telegram message object
 */
function handleListTasksCommand(msg) {
  const chatId = msg.chat.id;
  const tasks = getUserTaskList(chatId);
  
  bot.sendMessage(
    chatId,
    formatTasksMessage(tasks),
    { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Add New Task', callback_data: 'add_task' }],
          [
            { text: '🔄 Refresh List', callback_data: 'refresh_tasks' },
            { text: '📊 Stats', callback_data: 'stats' }
          ]
        ]
      }
    }
  );
}

/**
 * Handler for the /addtask command
 * @param {Object} msg - Telegram message object
 * @param {Array} match - Regex match array
 */
function handleAddTaskCommand(msg, match) {
  const chatId = msg.chat.id;
  const taskText = match[1]; // This will capture the text after /addtask
  
  if (!taskText || taskText.trim() === '') {
    bot.sendMessage(
      chatId,
      `⚠️ *Task description is required*\n\n` +
      `Please provide a description for your task.\n` +
      `Example: \`/addtask Read chapter 5\``,
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  const newTask = createTask(chatId, taskText.trim());
  
  bot.sendMessage(
    chatId,
    `✅ *Task added*\n\n` +
    `Task ${newTask.id}: ${newTask.text}\n\n` +
    `Use /tasks to see all your tasks.`,
    { parse_mode: 'Markdown' }
  );
}

/**
 * Handler for the /complete command
 * @param {Object} msg - Telegram message object
 * @param {Array} match - Regex match array
 */
function handleCompleteTaskCommand(msg, match) {
  try {
    const chatId = msg.chat.id;
    
    // If no task ID is provided, show task list with buttons
    if (!match[1]) {
      const tasks = getUserTaskList(chatId);
      
      if (tasks.length === 0) {
        bot.sendMessage(
          chatId,
          `📋 *No tasks found*\n\n` +
          `You don't have any tasks to complete yet.\n` +
          `Use /addtask [description] to add a new task.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      
      const taskButtons = tasks.map(task => {
        const status = task.completed ? '✅' : '⬜';
        return [
          { 
            text: `${status} ${task.id}. ${task.text.substring(0, 30)}${task.text.length > 30 ? '...' : ''}`, 
            callback_data: `complete_task_${task.id}`
          }
        ];
      });
      
      // Add a cancel button
      taskButtons.push([{ text: '❌ Cancel', callback_data: 'refresh_tasks' }]);
      
      bot.sendMessage(
        chatId,
        `🔄 *Select a task to mark as complete/incomplete*\n\n` +
        `Tap on a task to toggle its completion status:`,
        { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: taskButtons
          }
        }
      );
      return;
    }
    
    const taskId = parseInt(match[1]); // This will capture the ID after /complete
    
    if (isNaN(taskId)) {
      bot.sendMessage(
        chatId,
        `⚠️ *Invalid task ID*\n\n` +
        `Please provide a valid task ID.\n` +
        `Example: \`/complete 1\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    console.log(`Attempting to toggle completion for task ID: ${taskId}`);
    const updatedTask = toggleTaskCompletion(chatId, taskId);
    
    if (updatedTask) {
      const status = updatedTask.completed ? 'completed' : 'marked as incomplete';
      bot.sendMessage(
        chatId,
        `✓ *Task ${status}*\n\n` +
        `Task ${updatedTask.id}: ${updatedTask.text}\n\n` +
        `Use /tasks to see all your tasks.`,
        { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📋 View Task List', callback_data: 'refresh_tasks' }]
            ]
          }
        }
      );
    } else {
      bot.sendMessage(
        chatId,
        `⚠️ *Task not found*\n\n` +
        `No task found with ID ${taskId}.\n` +
        `Use /tasks to see all your tasks.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error(`Error in handleCompleteTaskCommand: ${error.message}`);
    bot.sendMessage(
      msg.chat.id,
      `⚠️ *Error*\n\nThere was a problem processing your request. Please try again.`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Handler for the /delete command
 * @param {Object} msg - Telegram message object
 * @param {Array} match - Regex match array
 */
function handleDeleteTaskCommand(msg, match) {
  try {
    const chatId = msg.chat.id;
    
    // If no task ID is provided, show task list with delete buttons
    if (!match[1]) {
      const tasks = getUserTaskList(chatId);
      
      if (tasks.length === 0) {
        bot.sendMessage(
          chatId,
          `📋 *No tasks found*\n\n` +
          `You don't have any tasks to delete yet.\n` +
          `Use /addtask [description] to add a new task.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      
      const taskButtons = tasks.map(task => {
        const status = task.completed ? '✅' : '⬜';
        return [
          { 
            text: `${status} ${task.id}. ${task.text.substring(0, 25)}${task.text.length > 25 ? '...' : ''}`, 
            callback_data: `delete_task_${task.id}`
          }
        ];
      });
      
      // Add a cancel button
      taskButtons.push([{ text: '❌ Cancel', callback_data: 'refresh_tasks' }]);
      
      bot.sendMessage(
        chatId,
        `🗑️ *Select a task to delete*\n\n` +
        `Tap on a task to delete it.\n` +
        `⚠️ *Warning:* This action cannot be undone!`,
        { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: taskButtons
          }
        }
      );
      return;
    }
    
    const taskId = parseInt(match[1]); // This will capture the ID after /delete
    
    if (isNaN(taskId)) {
      bot.sendMessage(
        chatId,
        `⚠️ *Invalid task ID*\n\n` +
        `Please provide a valid task ID.\n` +
        `Example: \`/delete 1\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    console.log(`Attempting to delete task ID: ${taskId}`);
    const deleted = removeTask(chatId, taskId);
    
    if (deleted) {
      bot.sendMessage(
        chatId,
        `🗑️ *Task deleted*\n\n` +
        `Task ${taskId} has been deleted.\n\n` +
        `Use /tasks to see all your remaining tasks.`,
        { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📋 View Task List', callback_data: 'refresh_tasks' }]
            ]
          }
        }
      );
    } else {
      bot.sendMessage(
        chatId,
        `⚠️ *Task not found*\n\n` +
        `No task found with ID ${taskId}.\n` +
        `Use /tasks to see all your tasks.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error(`Error in handleDeleteTaskCommand: ${error.message}`);
    bot.sendMessage(
      msg.chat.id,
      `⚠️ *Error*\n\nThere was a problem processing your request. Please try again.`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Handler for task completion callback
 * @param {string} callbackQueryId - Callback query ID
 * @param {number} chatId - Chat ID
 * @param {number} taskId - Task ID
 */
async function handleCompleteTaskCallback(callbackQueryId, chatId, taskId) {
  try {
    bot.answerCallbackQuery(callbackQueryId);
    
    console.log(`Toggling completion for task ID: ${taskId} via callback`);
    const updatedTask = toggleTaskCompletion(chatId, taskId);
    
    if (updatedTask) {
      const tasks = getUserTaskList(chatId);
      
      try {
        await bot.sendMessage(
          chatId,
          formatTasksMessage(tasks),
          { 
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '➕ Add New Task', callback_data: 'add_task' }],
                [
                  { text: '🔄 Refresh List', callback_data: 'refresh_tasks' },
                  { text: '📊 Stats', callback_data: 'stats' }
                ]
              ]
            }
          }
        );
      } catch (error) {
        console.error('Error sending updated task list:', error.message);
      }
    }
  } catch (error) {
    console.error(`Error in handleCompleteTaskCallback: ${error.message}`);
    
    try {
      await bot.sendMessage(
        chatId,
        "⚠️ *Error*\n\nThere was a problem completing your task. Please try again.",
        { parse_mode: 'Markdown' }
      );
    } catch (msgError) {
      console.error('Error sending error notification:', msgError.message);
    }
  }
}

/**
 * Handler for task deletion callback
 * @param {string} callbackQueryId - Callback query ID
 * @param {number} chatId - Chat ID
 * @param {number} taskId - Task ID
 */
async function handleDeleteTaskCallback(callbackQueryId, chatId, taskId) {
  try {
    bot.answerCallbackQuery(callbackQueryId);
    
    console.log(`Deleting task ID: ${taskId} via callback`);
    const deleted = removeTask(chatId, taskId);
    
    if (deleted) {
      const tasks = getUserTaskList(chatId);
      
      try {
        await bot.sendMessage(
          chatId,
          formatTasksMessage(tasks),
          { 
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '➕ Add New Task', callback_data: 'add_task' }],
                [
                  { text: '🔄 Refresh List', callback_data: 'refresh_tasks' },
                  { text: '📊 Stats', callback_data: 'stats' }
                ]
              ]
            }
          }
        );
      } catch (error) {
        console.error('Error sending updated task list:', error.message);
      }
    }
  } catch (error) {
    console.error(`Error in handleDeleteTaskCallback: ${error.message}`);
    
    try {
      await bot.sendMessage(
        chatId,
        "⚠️ *Error*\n\nThere was a problem deleting your task. Please try again.",
        { parse_mode: 'Markdown' }
      );
    } catch (msgError) {
      console.error('Error sending error notification:', msgError.message);
    }
  }
}

/**
 * Handler for the /stats command
 * @param {Object} msg - Telegram message object
 */
function handleStatsCommand(msg) {
  const chatId = msg.chat.id;
  
  bot.sendMessage(
    chatId,
    getFormattedStats(chatId),
    { parse_mode: 'Markdown' }
  );
}

/**
 * Handler for stats callback
 * @param {string} callbackQueryId - Callback query ID
 * @param {number} chatId - Chat ID
 */
async function handleStatsCallback(callbackQueryId, chatId) {
  bot.answerCallbackQuery(callbackQueryId);
  
  bot.sendMessage(
    chatId,
    getFormattedStats(chatId),
    { parse_mode: 'Markdown' }
  );
}

/**
 * Handler for tasks callback
 * @param {string} callbackQueryId - Callback query ID
 * @param {number} chatId - Chat ID
 */
async function handleTasksCallback(callbackQueryId, chatId) {
  bot.answerCallbackQuery(callbackQueryId);
  
  const tasks = getUserTaskList(chatId);
  
  bot.sendMessage(
    chatId,
    formatTasksMessage(tasks),
    { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Add New Task', callback_data: 'add_task' }],
          [
            { text: '🔄 Refresh List', callback_data: 'refresh_tasks' },
            { text: '📊 Stats', callback_data: 'stats' }
          ]
        ]
      }
    }
  );
}

/**
 * Handler for add task callback
 * @param {string} callbackQueryId - Callback query ID
 * @param {number} chatId - Chat ID
 */
async function handleAddTaskCallback(callbackQueryId, chatId) {
  try {
    // Update user session to indicate waiting for task input
    updateUserSession(chatId, { awaitingTaskInput: true });
    
    // Create a decorative border
    const border = '┏' + '━'.repeat(30) + '┓\n';
    const borderEnd = '┗' + '━'.repeat(30) + '┛';
    
    // Send prompt message
    await bot.sendMessage(
      chatId,
      `${border}` +
      `       ➕ *ADD NEW TASK* ➕\n\n` +
      `Please enter your task description. Be as specific as possible for better task management.\n\n` +
      `*Examples:*\n` +
      `• Read chapter 3 of physics textbook\n` +
      `• Complete math homework problems 1-10\n` +
      `• Study for tomorrow's history quiz\n` +
      `${borderEnd}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error handling add task callback:', error.message);
    
    try {
      await bot.sendMessage(
        chatId,
        "⚠️ *Error*\n\nThere was a problem processing your request. Please try using the command `/addtask [description]` instead.",
        { parse_mode: 'Markdown' }
      );
    } catch (msgError) {
      console.error('Error sending error notification:', msgError.message);
    }
  }
}

/**
 * Handler for refresh tasks callback
 * @param {string} callbackQueryId - Callback query ID
 * @param {number} chatId - Chat ID
 */
async function handleRefreshTasksCallback(callbackQueryId, chatId) {
  try {
    // Get updated task list
    const tasks = getUserTaskList(chatId);
    
    // Send updated task list with inline buttons
    await bot.sendMessage(
      chatId,
      formatTasksMessage(tasks),
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Add New Task', callback_data: 'add_task' }],
            [
              { text: '🔄 Refresh List', callback_data: 'refresh_tasks' },
              { text: '📊 Stats', callback_data: 'stats' }
            ]
          ]
        }
      }
    );
  } catch (error) {
    console.error('Error refreshing tasks:', error.message);
    
    try {
      await bot.sendMessage(
        chatId,
        "⚠️ *Error*\n\nThere was a problem refreshing your task list. Please try using the command `/tasks` instead.",
        { parse_mode: 'Markdown' }
      );
    } catch (msgError) {
      console.error('Error sending error notification:', msgError.message);
    }
  }
}

//======================================
// MAIN BOT SETUP
//======================================

// Register command handlers
bot.onText(/^\/start$/, handleStartCommand);
bot.onText(/^\/help$/, handleHelpCommand);
bot.onText(/^\/focus(?:\s+(.+))?$/, handleFocusCommand);
bot.onText(/^\/stop$/, handleStopFocusCommand);
bot.onText(/^\/pause$/, handlePauseFocusCommand);
bot.onText(/^\/resume$/, handleResumeFocusCommand);
bot.onText(/^\/tasks$/, handleListTasksCommand);
bot.onText(/^\/addtask\s+(.+)$/, handleAddTaskCommand);
bot.onText(/^\/complete(?:\s+(\d+))?$/, handleCompleteTaskCommand);
bot.onText(/^\/delete(?:\s+(\d+))?$/, handleDeleteTaskCommand);
bot.onText(/^\/stats$/, handleStatsCommand);

// Handle button presses (text buttons)
bot.onText(/🕒 25m Focus/, (msg) => handleFocusCommand(msg, [null, '25']));
bot.onText(/⏱ 45m Focus/, (msg) => handleFocusCommand(msg, [null, '45']));
bot.onText(/⏰ 60m Focus/, (msg) => handleFocusCommand(msg, [null, '60']));
bot.onText(/⚙️ Custom Timer/, (msg) => {
  const standardOptions = [
    [
      { text: '🕒 25 min', callback_data: 'focus_25' },
      { text: '⏱ 45 min', callback_data: 'focus_45' },
      { text: '⏰ 60 min', callback_data: 'focus_60' }
    ],
    [
      { text: '15 min', callback_data: 'focus_15' },
      { text: '20 min', callback_data: 'focus_20' },
      { text: '30 min', callback_data: 'focus_30' }
    ],
    [
      { text: '90 min', callback_data: 'focus_90' },
      { text: '120 min', callback_data: 'focus_120' }
    ],
    [
      { text: '⌨️ Enter Specific Time', callback_data: 'focus_specific' }
    ]
  ];
  
  // Create a decorative border
  const border = '┏' + '━'.repeat(30) + '┓\n';
  const borderEnd = '┗' + '━'.repeat(30) + '┛';
  
  bot.sendMessage(
    msg.chat.id,
    `${border}` +
    `      ⚙️ *CUSTOM TIMER* ⚙️\n\n` +
    `Select a pre-defined duration or enter a specific time for your study session:\n\n` +
    `• Short: 15, 20, 30 minutes\n` +
    `• Standard: 25, 45, 60 minutes\n` +
    `• Long: 90, 120 minutes\n` +
    `• Or enter a specific time\n` +
    `${borderEnd}`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: standardOptions
      }
    }
  );
});
bot.onText(/📋 Tasks/, handleListTasksCommand);
bot.onText(/📊 Stats/, handleStatsCommand);
bot.onText(/ℹ️ Help/, handleHelpCommand);

// Handle custom timer input and task input
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  // Skip command messages
  if (text && text.startsWith('/')) {
    return;
  }
  
  // Get user session
  const session = getUserSession(chatId);
  
  // Handle custom duration input
  if (session.awaitingCustomDuration) {
    // Try to parse the duration
    const duration = parseDuration(text);
    
    // Reset the awaiting state flag
    updateUserSession(chatId, { awaitingCustomDuration: false });
    
    if (duration && duration >= 5 && duration <= 180) {
      // Valid duration within limits
      await startFocusTimer(chatId, duration);
      
      // Border for the confirmation message
      const border = '┏' + '━'.repeat(25) + '┓\n';
      const borderEnd = '┗' + '━'.repeat(25) + '┛';
      
      await bot.sendMessage(
        chatId,
        `${border}` +
        `   ✅ *CUSTOM TIMER STARTED* ✅\n\n` +
        `Successfully started a *${duration}-minute* timer.\n` +
        `Stay focused and productive!\n` +
        `${borderEnd}`,
        { parse_mode: 'Markdown' }
      );
    } else {
      // Invalid duration
      bot.sendMessage(
        chatId,
        `⚠️ *Invalid Duration*\n\n` +
        `Please provide a valid duration between 5 and 180 minutes.\n` +
        `You entered: "${text}"\n\n` +
        `Try again with the /focus command.`,
        { parse_mode: 'Markdown' }
      );
    }
  } 
  // Handle task input
  else if (session.awaitingTaskInput) {
    // Reset the awaiting task input flag
    updateUserSession(chatId, { awaitingTaskInput: false });
    
    // Check if the task text is valid
    if (!text || text.trim() === '') {
      bot.sendMessage(
        chatId,
        `⚠️ *Empty Task*\n\n` +
        `Task description cannot be empty. Please try again with a valid description.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Create the new task
    const newTask = createTask(chatId, text.trim());
    
    // Border for the confirmation message
    const border = '┏' + '━'.repeat(25) + '┓\n';
    const borderEnd = '┗' + '━'.repeat(25) + '┛';
    
    // Confirm task creation
    await bot.sendMessage(
      chatId,
      `${border}` +
      `     ✅ *TASK ADDED* ✅\n\n` +
      `Successfully added task:\n` +
      `*${newTask.id}.* ${newTask.text}\n\n` +
      `View all your tasks with /tasks\n` +
      `${borderEnd}`,
      { parse_mode: 'Markdown' }
    );
    
    // Show updated task list
    const tasks = getUserTaskList(chatId);
    
    await bot.sendMessage(
      chatId,
      formatTasksMessage(tasks),
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Add Another Task', callback_data: 'add_task' }],
            [
              { text: '🔄 Refresh List', callback_data: 'refresh_tasks' },
              { text: '📊 Stats', callback_data: 'stats' }
            ]
          ]
        }
      }
    );
  }
});

// Handle callback queries from inline keyboards
bot.on('callback_query', async (callbackQuery) => {
  try {
    const action = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    
    // First acknowledge the callback query
    try {
      await bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
      console.error('Error answering callback query:', error.message);
      // Continue even if this fails as it's not critical
    }
    
    if (action.startsWith('focus_')) {
      const duration = action.split('_')[1];
      
      if (duration === 'custom' || duration === 'specific') {
        // Show custom timer menu with more options
        const standardOptions = [
          [
            { text: '15 min', callback_data: 'focus_15' },
            { text: '20 min', callback_data: 'focus_20' },
            { text: '30 min', callback_data: 'focus_30' }
          ],
          [
            { text: '40 min', callback_data: 'focus_40' },
            { text: '50 min', callback_data: 'focus_50' },
            { text: '70 min', callback_data: 'focus_70' }
          ],
          [
            { text: '80 min', callback_data: 'focus_80' },
            { text: '90 min', callback_data: 'focus_90' },
            { text: '120 min', callback_data: 'focus_120' }
          ],
          [
            { text: '⌨️ Enter Custom Time', callback_data: 'focus_specific_time' }
          ]
        ];
        
        // Create a decorative border
        const border = '┏' + '━'.repeat(30) + '┓\n';
        const borderEnd = '┗' + '━'.repeat(30) + '┛';
        
        await bot.sendMessage(
          chatId,
          `${border}` +
          `     ⚙️ *CUSTOM FOCUS TIMER* ⚙️\n\n` +
          `Choose from these additional time options or enter a specific duration for your study session:\n\n` +
          `• Select any preset duration\n` +
          `• Or enter a custom time (e.g., 25m, 1h, 1h30m)\n` +
          `${borderEnd}`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: standardOptions
            }
          }
        );
      } else if (duration === 'specific_time') {
        // Set a flag in user session to await custom time input
        updateUserSession(chatId, { awaitingCustomDuration: true });
        
        await bot.sendMessage(
          chatId,
          `⌨️ *Enter Custom Time*\n\n` +
          `Please enter a specific duration for your study session.\n\n` +
          `*Examples:*\n` +
          `• 25m (25 minutes)\n` +
          `• 1h (1 hour)\n` +
          `• 1h30m (1 hour and 30 minutes)\n\n` +
          `*Valid range:* 5-180 minutes`,
          { parse_mode: 'Markdown' }
        );
      } else {
        // Convert the duration to a number and handle
        const durationNum = parseInt(duration);
        if (!isNaN(durationNum) && durationNum > 0) {
          handleFocusCallback(callbackQuery.id, chatId, durationNum);
        } else {
          await bot.sendMessage(
            chatId,
            "⚠️ Invalid timer duration. Please try again.",
            { parse_mode: 'Markdown' }
          );
        }
      }
    } else if (action === 'stop_focus') {
      handleStopFocusCallback(callbackQuery.id, chatId);
    } else if (action === 'pause_focus') {
      handlePauseFocusCallback(callbackQuery.id, chatId);
    } else if (action === 'resume_focus') {
      handleResumeFocusCallback(callbackQuery.id, chatId);
    } else if (action.startsWith('complete_task_')) {
      const taskId = parseInt(action.split('_')[2]);
      handleCompleteTaskCallback(callbackQuery.id, chatId, taskId);
    } else if (action.startsWith('delete_task_')) {
      const taskId = parseInt(action.split('_')[2]);
      handleDeleteTaskCallback(callbackQuery.id, chatId, taskId);
    } else if (action === 'stats') {
      handleStatsCallback(callbackQuery.id, chatId);
    } else if (action === 'tasks') {
      handleTasksCallback(callbackQuery.id, chatId);
    } else if (action === 'add_task') {
      await handleAddTaskCallback(callbackQuery.id, chatId);
    } else if (action === 'refresh_tasks') {
      await handleRefreshTasksCallback(callbackQuery.id, chatId);
    }
  } catch (error) {
    console.error('Error handling callback query:', error.message);
    
    try {
      // Try to send an error message
      await bot.sendMessage(
        callbackQuery.message.chat.id,
        "⚠️ *Error*\n\nThere was a problem processing your request. Please try again.",
        { parse_mode: 'Markdown' }
      );
    } catch (msgError) {
      console.error('Error sending error notification:', msgError.message);
    }
  }
});

// Setup periodic cleanup job to remove stale timers
schedule.scheduleJob('*/30 * * * *', cleanupTimers); // Run every 30 minutes

// Handle errors
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

console.log('Study Focus Bot is now running!');
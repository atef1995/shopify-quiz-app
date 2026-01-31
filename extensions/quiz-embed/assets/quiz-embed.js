/**
 * Product Quiz Embed - Client-side Logic
 *
 * Handles quiz flow, question navigation, email capture,
 * and product recommendations on the storefront.
 *
 * Features:
 * ✅ Fetches quiz data from API
 * ✅ localStorage for progress persistence (prevents loss on refresh)
 * ✅ Budget-aware conditional logic
 * TODO: Add analytics events (quiz_started, question_answered, quiz_completed)
 * TODO: Add error retry logic for failed API calls
 * TODO: Add keyboard navigation support (arrow keys, Enter)
 */

(function () {
  'use strict';

  // Quiz state
  let quizData = null;
  let currentQuestionIndex = 0;
  let answers = [];
  let customerEmail = null;

  // Timing analytics
  let quizStartTime = null;
  let questionStartTime = null;
  let questionTiming = {}; // { questionId: timeSpentInSeconds }

  // localStorage key prefix for this quiz session
  let storageKey = null;

  // DOM elements
  const container = document.querySelector('.quiz-container');
  if (!container) {
    console.error('Quiz container not found. Make sure the quiz block is properly added to your theme.');
    return;
  }

  const quizId = container.dataset.quizId;
  console.log('Container found:', container);
  console.log('Quiz ID from data attribute:', quizId);
  console.log('Container dataset:', container.dataset);

  // Use Shopify App Proxy path for API calls from storefront
  // Requests to /apps/quiz-app/api/* are proxied to the app
  const API_BASE_URL = window.location.origin + '/apps/quiz-app';
  const loadingEl = document.getElementById('quiz-loading');
  const contentEl = document.getElementById('quiz-content');
  const emailCaptureEl = document.getElementById('quiz-email-capture');
  const resultsEl = document.getElementById('quiz-results');
  const errorEl = document.getElementById('quiz-error');

  /**
   * Send webhook event (non-blocking)
   */
  function sendWebhook(event, data = {}) {
    fetch(`${API_BASE_URL}/api/webhooks/${event}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        quizId: quizId,
        ...data,
      }),
    }).catch(error => {
      console.warn(`Webhook delivery failed for ${event}:`, error);
    });
  }

  /**
   * Apply custom styling from Shopify block settings
   */
  function applyCustomStyling() {
    const primaryColor = container.dataset.primaryColor || '#667eea';
    const secondaryColor = container.dataset.secondaryColor || '#f8f9fa';
    const textColor = container.dataset.textColor || '#333333';
    const backgroundColor = container.dataset.backgroundColor || '#ffffff';
    const borderRadius = container.dataset.borderRadius || '8px';
    const fontFamily = container.dataset.fontFamily || 'inherit';

    // Create custom CSS
    const customCSS = `
      <style id="quiz-custom-styles">
        .quiz-container {
          --quiz-primary-color: ${primaryColor};
          --quiz-secondary-color: ${secondaryColor};
          --quiz-text-color: ${textColor};
          --quiz-background-color: ${backgroundColor};
          --quiz-border-radius: ${borderRadius};
          --quiz-font-family: ${fontFamily};
        }

        .quiz-wrapper {
          font-family: var(--quiz-font-family, inherit) !important;
          background-color: var(--quiz-background-color, #ffffff) !important;
          color: var(--quiz-text-color, #333333) !important;
          border-radius: var(--quiz-border-radius, 8px) !important;
        }

        .quiz-btn-primary {
          background-color: var(--quiz-primary-color, #667eea) !important;
          border-color: var(--quiz-primary-color, #667eea) !important;
        }

        .quiz-btn-primary:hover {
          background-color: ${adjustColor(primaryColor, -20)} !important;
          border-color: ${adjustColor(primaryColor, -20)} !important;
        }

        .quiz-btn-secondary {
          background-color: var(--quiz-secondary-color, #f8f9fa) !important;
          border-color: var(--quiz-secondary-color, #f8f9fa) !important;
          color: var(--quiz-text-color, #333333) !important;
        }

        .quiz-btn-secondary:hover {
          background-color: ${adjustColor(secondaryColor, -10)} !important;
        }

        .quiz-progress-bar {
          background-color: var(--quiz-secondary-color, #f8f9fa) !important;
        }

        .quiz-progress-fill {
          background-color: var(--quiz-primary-color, #667eea) !important;
        }

        .email-input {
          border-radius: var(--quiz-border-radius, 8px) !important;
          border-color: var(--quiz-secondary-color, #f8f9fa) !important;
        }

        .email-input:focus {
          border-color: var(--quiz-primary-color, #667eea) !important;
          box-shadow: 0 0 0 2px ${primaryColor}33 !important;
        }
      </style>
    `;

    // Insert custom CSS into head
    document.head.insertAdjacentHTML('beforeend', customCSS);
  }

  /**
   * Helper function to adjust color brightness
   */
  function adjustColor(color, amount) {
    // Simple color adjustment - darken by reducing RGB values
    const usePound = color[0] === '#';
    const col = usePound ? color.slice(1) : color;

    const num = parseInt(col, 16);
    let r = (num >> 16) + amount;
    let g = (num >> 8 & 0x00FF) + amount;
    let b = (num & 0x0000FF) + amount;

    r = r > 255 ? 255 : r < 0 ? 0 : r;
    g = g > 255 ? 255 : g < 0 ? 0 : g;
    b = b > 255 ? 255 : b < 0 ? 0 : b;

    return (usePound ? '#' : '') + (r << 16 | g << 8 | b).toString(16);
  }

  /**
   * LocalStorage helper functions for quiz progress persistence
   */

  // Generate unique storage key for this quiz session
  function getStorageKey() {
    if (!storageKey && quizId) {
      storageKey = `quiz_progress_${quizId}`;
    }
    return storageKey;
  }

  // Save current progress to localStorage
  function saveProgress() {
    try {
      const progress = {
        answers: answers,
        currentQuestionIndex: currentQuestionIndex,
        email: customerEmail,
        timestamp: Date.now(),
        quizId: quizId
      };
      localStorage.setItem(getStorageKey(), JSON.stringify(progress));
      console.log('Progress saved to localStorage:', progress);
    } catch (error) {
      console.warn('Failed to save progress to localStorage:', error);
      // Non-critical error - quiz continues to work without persistence
    }
  }

  // Load progress from localStorage
  function loadProgress() {
    try {
      const stored = localStorage.getItem(getStorageKey());
      if (!stored) return null;

      const progress = JSON.parse(stored);

      // Verify it's for the same quiz
      if (progress.quizId !== quizId) {
        clearProgress();
        return null;
      }

      // Check if progress is stale (older than 7 days)
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
      if (Date.now() - progress.timestamp > maxAge) {
        clearProgress();
        return null;
      }

      console.log('Loaded progress from localStorage:', progress);
      return progress;
    } catch (error) {
      console.warn('Failed to load progress from localStorage:', error);
      return null;
    }
  }

  // Clear saved progress
  function clearProgress() {
    try {
      localStorage.removeItem(getStorageKey());
      console.log('Progress cleared from localStorage');
    } catch (error) {
      console.warn('Failed to clear progress:', error);
    }
  }

  // Show notification that progress was restored
  function showProgressRestoredNotification() {
    const notification = document.createElement('div');
    notification.className = 'quiz-progress-notification';
    notification.textContent = `✓ Welcome back! Resuming from question ${currentQuestionIndex + 1}`;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #008060;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      font-size: 14px;
      font-weight: 500;
      animation: slideDown 0.3s ease;
    `;

    document.body.appendChild(notification);

    // Remove after 3 seconds
    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transition = 'opacity 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  /**
   * Initialize quiz - fetch quiz data and render first question
   */
  async function initQuiz() {
    try {
      console.log('Initializing quiz with ID:', quizId);

      // Fetch real quiz data from API
      if (!quizId) {
        throw new Error('Quiz ID is missing from block settings');
      }

      // TODO: Get actual app URL from Shopify app proxy or configuration
      // For now, attempt to fetch from current domain
      const apiUrl = `${API_BASE_URL}/api/quiz/${quizId}`;
      console.log('Fetching quiz from:', apiUrl);

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log('API Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error response:', errorText);

        if (response.status === 404) {
          throw new Error('Quiz not found or not active. Check that your quiz exists and is set to "active" status.');
        }
        throw new Error(`Failed to load quiz (${response.status}): ${errorText}`);
      }

      quizData = await response.json();
      console.log('Quiz data loaded:', quizData);

      // Validate quiz data
      if (!quizData || !quizData.questions || quizData.questions.length === 0) {
        throw new Error('Quiz data is empty or invalid. Make sure your quiz has questions.');
      }

      console.log(`Quiz loaded successfully with ${quizData.questions.length} questions`);

      // Apply custom styling from block settings
      applyCustomStyling();

      // Try to restore previous progress
      const savedProgress = loadProgress();
      if (savedProgress && savedProgress.answers && savedProgress.answers.length > 0) {
        // Validate saved answers match current quiz structure
        const isValid = savedProgress.answers.every((answer, idx) => {
          if (idx >= quizData.questions.length) return false;
          const question = quizData.questions[idx];
          return question && question.options.some(opt => opt.id === answer.optionId);
        });

        if (isValid) {
          answers = savedProgress.answers;
          currentQuestionIndex = Math.min(savedProgress.currentQuestionIndex || 0, quizData.questions.length - 1);
          customerEmail = savedProgress.email;
          console.log(`Restored progress: ${answers.length} answers, question ${currentQuestionIndex + 1}`);

          // Show brief notification that progress was restored
          showProgressRestoredNotification();
        } else {
          console.warn('Saved progress is invalid (quiz structure may have changed), starting fresh');
          clearProgress();
        }
      }

      loadingEl.style.display = 'none';
      contentEl.style.display = 'block';

      // Initialize timing analytics
      quizStartTime = Date.now();
      questionTiming = {};

      // Send quiz started webhook
      sendWebhook('quiz_started', {
        quizTitle: quizData.title,
        totalQuestions: quizData.questions.length,
      });

      renderQuestion();
      updateProgress();
      setupEventListeners();

    } catch (error) {
      console.error('Failed to load quiz:', error);
      loadingEl.style.display = 'none';

      // Show detailed error message
      const errorMessageEl = errorEl.querySelector('p');
      if (errorMessageEl) {
        errorMessageEl.textContent = `Error loading quiz: ${error.message}`;
      }

      showError();
    }
  }

  /**
   * Render current question with conditional logic filtering
   */
  function renderQuestion() {
    const question = quizData.questions[currentQuestionIndex];

    // Track question start time for analytics
    questionStartTime = Date.now();

    // Update header
    document.querySelector('.quiz-title').textContent = quizData.title;
    document.querySelector('.quiz-description').textContent = quizData.description;

    // Update question text
    document.querySelector('.question-text').textContent = question.text;

    // Apply conditional logic filtering based on previous answers
    let filteredOptions = filterOptionsByBudget(question);

    // Render options
    const optionsContainer = document.querySelector('.quiz-options');
    optionsContainer.innerHTML = '';

    filteredOptions.forEach(option => {
      const optionEl = document.createElement('div');
      optionEl.className = 'quiz-option';
      optionEl.dataset.optionId = option.id;

      if (option.imageUrl) {
        const img = document.createElement('img');
        img.src = option.imageUrl;
        img.alt = option.text;
        optionEl.appendChild(img);
      }

      const textEl = document.createElement('div');
      textEl.className = 'option-text';
      textEl.textContent = option.text;
      optionEl.appendChild(textEl);

      // Check if this option was previously selected
      const previousAnswer = answers[currentQuestionIndex];
      if (previousAnswer && previousAnswer.optionId === option.id) {
        optionEl.classList.add('selected');
      }

      optionEl.addEventListener('click', (e) => selectOption(option, e));
      optionsContainer.appendChild(optionEl);
    });

    // Update navigation buttons
    const backBtn = document.querySelector('.quiz-btn-back');
    const nextBtn = document.querySelector('.quiz-btn-next');

    backBtn.style.display = currentQuestionIndex > 0 ? 'block' : 'none';

    // Update next button text based on position
    const isLastQuestion = currentQuestionIndex === quizData.questions.length - 1;
    nextBtn.textContent = isLastQuestion
      ? nextBtn.dataset.resultsText || 'See Results'
      : nextBtn.dataset.nextText || 'Next';

    // Enable next button if answer exists
    nextBtn.disabled = !answers[currentQuestionIndex];
  }

  /**
   * Filter question options based on budget selection from previous answers
   * Implements smart conditional logic so users only see relevant options
   */
  function filterOptionsByBudget(question) {
    // If this question doesn't have conditional rules, return all options
    if (!question.conditionalRules || !question.conditionalRules.filterByBudget) {
      return question.options;
    }

    // Find budget answer from previous questions
    let budgetMin = 0;
    let budgetMax = Infinity;

    for (let i = 0; i < currentQuestionIndex; i++) {
      const answer = answers[i];
      if (!answer) continue;

      const answeredQuestion = quizData.questions[i];
      const selectedOption = answeredQuestion.options.find(opt => opt.id === answer.optionId);

      if (selectedOption && (selectedOption.budgetMin !== undefined || selectedOption.budgetMax !== undefined)) {
        // Found budget selection
        budgetMin = selectedOption.budgetMin || 0;
        budgetMax = selectedOption.budgetMax || Infinity;
        break;
      }
    }

    // Filter options based on budget
    // Only show product types that have items within the selected budget range
    return question.options.filter(option => {
      if (!option.priceRange) return true; // No price info, include it

      const { min, max } = option.priceRange;

      // Check if this product type has ANY items within the budget
      // Include if: type's min price is within budget OR type's max price is within budget
      const hasAffordableItems = min <= budgetMax && max >= budgetMin;

      return hasAffordableItems;
    });
  }

  /**
   * Handle option selection
   */
  function selectOption(option, event) {
    // Remove previous selection
    document.querySelectorAll('.quiz-option').forEach(el => {
      el.classList.remove('selected');
    });

    // Add selection to clicked option
    if (event && event.target) {
      event.target.closest('.quiz-option').classList.add('selected');
    }

    // Save answer
    answers[currentQuestionIndex] = {
      questionId: quizData.questions[currentQuestionIndex].id,
      optionId: option.id,
      optionText: option.text
    };

    // Save progress to localStorage immediately
    saveProgress();

    // Send question answered webhook
    sendWebhook('question_answered', {
      questionId: quizData.questions[currentQuestionIndex].id,
      questionText: quizData.questions[currentQuestionIndex].text,
      answer: option.text,
      questionNumber: currentQuestionIndex + 1,
      totalQuestions: quizData.questions.length,
    });

    // Enable next button
    document.querySelector('.quiz-btn-next').disabled = false;

    // TODO: Send analytics event: quiz_question_answered
  }

  /**
   * Navigate to next question
   */
  function nextQuestion() {
    // Track time spent on current question
    if (questionStartTime) {
      const timeSpent = (Date.now() - questionStartTime) / 1000; // Convert to seconds
      const questionId = quizData.questions[currentQuestionIndex].id;
      questionTiming[questionId] = timeSpent;
    }

    if (currentQuestionIndex < quizData.questions.length - 1) {
      currentQuestionIndex++;
      saveProgress(); // Save progress when navigating
      renderQuestion();
      updateProgress();
    } else {
      // Quiz completed
      if (quizData.settings.emailCapture) {
        showEmailCapture();
      } else {
        showResults();
      }
    }
  }

  /**
   * Navigate to previous question
   */
  function previousQuestion() {
    // Track time spent on current question before going back
    if (questionStartTime) {
      const timeSpent = (Date.now() - questionStartTime) / 1000; // Convert to seconds
      const questionId = quizData.questions[currentQuestionIndex].id;
      questionTiming[questionId] = timeSpent;
    }

    if (currentQuestionIndex > 0) {
      currentQuestionIndex--;
      saveProgress(); // Save progress when navigating back
      renderQuestion();
      updateProgress();
    }
  }

  /**
   * Update progress bar
   */
  function updateProgress() {
    const progress = ((currentQuestionIndex + 1) / quizData.questions.length) * 100;
    document.querySelector('.quiz-progress-fill').style.width = `${progress}%`;
    document.querySelector('.current-question').textContent = currentQuestionIndex + 1;
    document.querySelector('.total-questions').textContent = quizData.questions.length;
  }

  /**
   * Show email capture screen
   */
  function showEmailCapture() {
    contentEl.style.display = 'none';
    emailCaptureEl.style.display = 'block';

    const form = document.getElementById('email-capture-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      customerEmail = form.querySelector('input[name="email"]').value;

      // Send email captured webhook
      sendWebhook('email_captured', {
        email: customerEmail,
        quizTitle: quizData.title,
        totalQuestions: quizData.questions.length,
        answersCount: answers.length,
      });

      await submitQuizResults();
    });
  }

  /**
   * Submit quiz results to backend
   *
   * TODO: Add loading spinner during submission
   * TODO: Send analytics event: quiz_completed
   */
  async function submitQuizResults() {
    try {
      // Submit quiz results to backend
      const apiUrl = `${API_BASE_URL}/api/quiz/submit`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quizId: quizData.id,
          email: customerEmail,
          answers: answers,
          timing: {
            quizStartTime: quizStartTime,
            questionTiming: questionTiming,
            totalTimeSeconds: quizStartTime ? (Date.now() - quizStartTime) / 1000 : null,
          },
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          // Usage limit reached
          alert('Quiz limit reached. Please try again later.');
          return;
        }
        throw new Error(`Failed to submit quiz: ${response.status}`);
      }

      const data = await response.json();

      // Show results with real product recommendations
      showResults(data.recommendedProducts);

    } catch (error) {
      console.error('Failed to submit quiz:', error);
      // Show error message to user
      alert('Sorry, something went wrong. Please try again.');
      showError();
    }
  }

  /**
   * Display results with product recommendations
   *
   * TODO: Display real products from API response
   * TODO: Add "Add to Cart" functionality for each product
   * TODO: Track which products are clicked for analytics
   * TODO: Add social sharing buttons
   * TODO: Send analytics event: quiz_results_viewed
   */
  function showResults(products) {
    // Clear saved progress once quiz is completed successfully
    clearProgress();

    emailCaptureEl.style.display = 'none';
    resultsEl.style.display = 'block';

    const productsContainer = document.getElementById('results-products');

    // Use products from API response
    // Fallback to placeholder if no products provided
    const recommendedProducts = products && products.length > 0 ? products : [
      {
        id: '1',
        title: 'Product 1',
        price: '$99.99',
        imageUrl: 'https://via.placeholder.com/200',
        url: '#'
      },
      {
        id: '2',
        title: 'Product 2',
        price: '$149.99',
        imageUrl: 'https://via.placeholder.com/200',
        url: '#'
      },
      {
        id: '3',
        title: 'Product 3',
        price: '$79.99',
        imageUrl: 'https://via.placeholder.com/200',
        url: '#'
      }
    ];

    productsContainer.innerHTML = '';

    if (recommendedProducts.length === 0) {
      productsContainer.innerHTML = '<p>No products found matching your preferences.</p>';
      return;
    }

    recommendedProducts.forEach(product => {
      const productEl = document.createElement('div');
      productEl.className = 'result-product';

      // Extract numeric variant ID from GraphQL ID (format: gid://shopify/ProductVariant/12345)
      const variantId = product.variantId ? product.variantId.split('/').pop() : null;

      console.log('Product:', product.title, 'Variant ID:', variantId, 'Full variantId:', product.variantId);

      // Truncate description to 100 characters for preview
      const shortDescription = product.description
        ? (product.description.length > 100
          ? product.description.substring(0, 100) + '...'
          : product.description)
        : '';

      // Build image carousel HTML
      const images = product.images && product.images.length > 0 ? product.images : [{ url: product.imageUrl, altText: product.title }];
      const carouselIndicators = images.length > 1
        ? `<div class="carousel-indicators">
            ${images.map((_, idx) => `<span class="indicator ${idx === 0 ? 'active' : ''}" data-index="${idx}"></span>`).join('')}
           </div>`
        : '';

      productEl.innerHTML = `
        <div class="product-image-wrapper">
          <img src="${product.imageUrl || images[0].url}" alt="${product.title}" class="product-main-image" />
          <div class="product-hover-overlay">
            <div class="product-carousel">
              ${images.map((img, idx) =>
        `<img src="${img.url}" alt="${img.altText || product.title}" class="carousel-image ${idx === 0 ? 'active' : ''}" data-index="${idx}" />`
      ).join('')}
            </div>
            ${carouselIndicators}
            <div class="product-description">
              <p>${shortDescription}</p>
            </div>
            <a href="${product.url}" class="view-details-btn" target="_blank">View Full Details →</a>
          </div>
        </div>
        <div class="result-product-info">
          <div class="result-product-title">${product.title}</div>
          <div class="result-product-price">${product.price}</div>
          ${variantId ?
          `<button class="result-product-btn" data-variant-id="${variantId}" data-product-title="${product.title}">
              Add to Cart
            </button>` :
          `<button class="result-product-btn" onclick="window.location.href='${product.url}'">
              View Product
            </button>`
        }
        </div>
      `;

      // Add click handler for Add to Cart button
      if (variantId) {
        const btn = productEl.querySelector('.result-product-btn');
        btn.addEventListener('click', () => addToCart(variantId, product.title));
      }

      // Add hover interaction handlers
      setupProductHoverInteractions(productEl, images);

      productsContainer.appendChild(productEl);
    });
  }

  /**
   * Setup hover interactions for product cards
   * Handles image carousel navigation and overlay display
   * 
   * @param {HTMLElement} productEl - The product card element
   * @param {Array} images - Array of image objects with url and altText
   */
  function setupProductHoverInteractions(productEl, images) {
    if (images.length <= 1) return; // No carousel needed for single image

    const overlay = productEl.querySelector('.product-hover-overlay');
    const carouselImages = productEl.querySelectorAll('.carousel-image');
    const indicators = productEl.querySelectorAll('.indicator');
    let currentIndex = 0;
    let carouselInterval = null;

    // Auto-rotate images every 2 seconds on hover
    productEl.addEventListener('mouseenter', () => {
      overlay.style.opacity = '1';
      overlay.style.pointerEvents = 'auto';

      // Start auto-rotation
      carouselInterval = setInterval(() => {
        currentIndex = (currentIndex + 1) % images.length;
        updateCarousel();
      }, 2000);
    });

    productEl.addEventListener('mouseleave', () => {
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';

      // Stop auto-rotation and reset to first image
      clearInterval(carouselInterval);
      currentIndex = 0;
      updateCarousel();
    });

    // Click indicators to jump to specific image
    indicators.forEach((indicator, idx) => {
      indicator.addEventListener('click', (e) => {
        e.stopPropagation();
        clearInterval(carouselInterval); // Stop auto-rotation on manual interaction
        currentIndex = idx;
        updateCarousel();

        // Resume auto-rotation after 3 seconds
        setTimeout(() => {
          carouselInterval = setInterval(() => {
            currentIndex = (currentIndex + 1) % images.length;
            updateCarousel();
          }, 2000);
        }, 3000);
      });
    });

    function updateCarousel() {
      carouselImages.forEach((img, idx) => {
        img.classList.toggle('active', idx === currentIndex);
      });
      indicators.forEach((ind, idx) => {
        ind.classList.toggle('active', idx === currentIndex);
      });
    }
  }

  /**
   * Add product to cart using Shopify Ajax API
   * 
   * @param {string} variantId - The variant ID to add to cart
   * @param {string} productTitle - Product title for user feedback
   */
  async function addToCart(variantId, productTitle) {
    // Find the button that was clicked
    const button = event.target;
    const originalText = button.textContent;

    console.log('Add to cart called with variantId:', variantId);

    try {
      // Disable button and show loading state
      button.disabled = true;
      button.textContent = 'Adding...';

      // Ensure variantId is numeric (Shopify Ajax API requires numeric ID)
      const numericId = parseInt(variantId, 10);
      if (isNaN(numericId)) {
        throw new Error(`Invalid variant ID: ${variantId}`);
      }

      console.log('Adding variant to cart:', numericId);

      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: [{
            id: numericId,
            quantity: 1
          }]
        })
      });

      console.log('Cart add response:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Cart add failed:', errorText);
        throw new Error(`Failed to add to cart: ${response.status}`);
      }

      const result = await response.json();
      console.log('Cart add successful:', result);

      // Show success state
      button.textContent = '✓ Added!';
      button.style.background = '#10b981';

      // Update cart count in header
      try {
        const cartResponse = await fetch('/cart.js');
        const cartData = await cartResponse.json();

        // Try multiple selectors for cart count
        const countSelectors = [
          '.cart-count',
          '[data-cart-count]',
          '#cart-count',
          '.cart__count',
          '[data-header-cart-count]',
          'cart-count-bubble',
        ];

        let cartUpdated = false;
        countSelectors.forEach(selector => {
          const countEl = document.querySelector(selector);
          if (countEl) {
            countEl.textContent = cartData.item_count;
            countEl.style.display = cartData.item_count > 0 ? '' : 'none';
            cartUpdated = true;
          }
        });

        // Trigger cart refresh events
        document.dispatchEvent(new CustomEvent('cart:refresh'));
        window.dispatchEvent(new CustomEvent('theme:cart:change', {
          detail: { cart: cartData }
        }));

        // Show notification toast
        showCartNotification(productTitle, cartData.item_count);

        console.log('Cart updated:', cartUpdated, 'Items:', cartData.item_count);

      } catch (e) {
        console.log('Could not update cart:', e);
        // Still show notification even if count update fails
        showCartNotification(productTitle, null);
      }

      // Reset button after 2 seconds
      setTimeout(() => {
        button.textContent = originalText;
        button.style.background = '';
        button.disabled = false;
      }, 2000);

    } catch (error) {
      console.error('Error adding to cart:', error);

      // Show error state
      button.textContent = '✗ Error';
      button.style.background = '#ef4444';

      // Reset button after 2 seconds
      setTimeout(() => {
        button.textContent = originalText;
        button.style.background = '';
        button.disabled = false;
      }, 2000);
    }
  }

  /**
   * Show cart notification toast
   * 
   * @param {string} productTitle - Product that was added
   * @param {number|null} itemCount - Total items in cart
   */
  function showCartNotification(productTitle, itemCount) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'quiz-cart-notification';
    notification.innerHTML = `
      <div class="quiz-cart-notification-content">
        <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20" style="flex-shrink: 0;">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
        </svg>
        <div>
          <strong>${productTitle}</strong> added to cart
          ${itemCount ? `<div style="font-size: 0.875rem; opacity: 0.9;">${itemCount} item${itemCount > 1 ? 's' : ''} in cart</div>` : ''}
        </div>
      </div>
      <a href="/cart" class="quiz-cart-notification-link">View Cart →</a>
    `;

    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => notification.classList.add('show'), 10);

    // Remove after 5 seconds
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 5000);
  }

  /**
   * Show error state
   */
  function showError() {
    loadingEl.style.display = 'none';
    contentEl.style.display = 'none';
    errorEl.style.display = 'block';
  }

  /**
   * Setup event listeners
   */
  function setupEventListeners() {
    document.querySelector('.quiz-btn-next').addEventListener('click', nextQuestion);
    document.querySelector('.quiz-btn-back').addEventListener('click', previousQuestion);
  }

  // Initialize quiz when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initQuiz);
  } else {
    initQuiz();
  }
})();

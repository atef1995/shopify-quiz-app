/**
 * Product Quiz Embed - Client-side Logic
 *
 * Handles quiz flow, question navigation, email capture,
 * and product recommendations on the storefront.
 *
 * TODO: CRITICAL - Connect to real API endpoints instead of using placeholder data
 * TODO: Add localStorage to save quiz progress (prevent loss on page refresh)
 * TODO: Add analytics events (quiz_started, question_answered, quiz_completed)
 * TODO: Add loading states for async operations
 * TODO: Add error retry logic for failed API calls
 * TODO: Add keyboard navigation support (arrow keys, Enter)
 * BUG: Currently using hardcoded quiz data instead of fetching from API
 */

(function () {
  'use strict';

  // Quiz state
  let quizData = null;
  let currentQuestionIndex = 0;
  let answers = [];
  let customerEmail = null;

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

      loadingEl.style.display = 'none';
      contentEl.style.display = 'block';

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
   * Render current question
   */
  function renderQuestion() {
    const question = quizData.questions[currentQuestionIndex];

    // Update header
    document.querySelector('.quiz-title').textContent = quizData.title;
    document.querySelector('.quiz-description').textContent = quizData.description;

    // Update question text
    document.querySelector('.question-text').textContent = question.text;

    // Render options
    const optionsContainer = document.querySelector('.quiz-options');
    optionsContainer.innerHTML = '';

    question.options.forEach(option => {
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

      optionEl.addEventListener('click', () => selectOption(option));
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
   * Handle option selection
   *
   * TODO: Add animation when selecting option
   * TODO: Save to localStorage immediately for progress persistence
   * BUG: Uses global 'event' which could fail in some browsers - pass event as parameter
   */
  function selectOption(option) {
    // Remove previous selection
    document.querySelectorAll('.quiz-option').forEach(el => {
      el.classList.remove('selected');
    });

    // Add selection to clicked option
    // BUG: Relies on global 'event' object - not reliable in all browsers
    event.target.closest('.quiz-option').classList.add('selected');

    // Save answer
    // TODO: Validate option exists in current question before saving
    answers[currentQuestionIndex] = {
      questionId: quizData.questions[currentQuestionIndex].id,
      optionId: option.id,
      optionText: option.text
    };

    // Enable next button
    document.querySelector('.quiz-btn-next').disabled = false;

    // TODO: Send analytics event: quiz_question_answered
  }

  /**
   * Navigate to next question
   */
  function nextQuestion() {
    if (currentQuestionIndex < quizData.questions.length - 1) {
      currentQuestionIndex++;
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
    if (currentQuestionIndex > 0) {
      currentQuestionIndex--;
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
      await submitQuizResults();
    });
  }

  /**
   * Submit quiz results to backend
   *
   * TODO: CRITICAL - Implement real API call to /api/quiz/submit
   * TODO: Add loading spinner during submission
   * TODO: Handle rate limit errors (429) gracefully
   * TODO: Handle usage limit exceeded errors
   * TODO: Send analytics event: quiz_completed
   * BUG: No actual API call - quiz results never saved to database
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
   * Show quiz results with product recommendations
   *
   * TODO: Display real products from API response
   * TODO: Add "Add to Cart" functionality for each product
   * TODO: Track which products are clicked for analytics
   * TODO: Add social sharing buttons
   * TODO: Send analytics event: quiz_results_viewed
   * BUG: Showing placeholder products instead of real recommendations
   */
  function showResults(products) {
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

      productEl.innerHTML = `
        <img src="${product.imageUrl || product.image}" alt="${product.title}" />
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

      productsContainer.appendChild(productEl);
    });
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

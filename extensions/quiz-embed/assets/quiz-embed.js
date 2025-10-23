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

(function() {
  'use strict';

  // Quiz state
  let quizData = null;
  let currentQuestionIndex = 0;
  let answers = [];
  let customerEmail = null;

  // DOM elements
  const container = document.querySelector('.quiz-container');
  if (!container) return;

  const quizId = container.dataset.quizId;

  // TODO: Get API base URL from app configuration or environment
  // For now, construct it from current location
  const API_BASE_URL = window.location.origin;
  const loadingEl = document.getElementById('quiz-loading');
  const contentEl = document.getElementById('quiz-content');
  const emailCaptureEl = document.getElementById('quiz-email-capture');
  const resultsEl = document.getElementById('quiz-results');
  const errorEl = document.getElementById('quiz-error');

  /**
   * Initialize quiz - fetch quiz data and render first question
   *
   * TODO: Replace simulated data with real API call to /api/quiz/:id
   * TODO: Add retry logic if API call fails (3 retries with exponential backoff)
   * TODO: Show specific error messages based on error type (404, 500, network error)
   * BUG: No loading timeout - if API never responds, spinner shows forever
   */
  async function initQuiz() {
    try {
      // Fetch real quiz data from API
      if (!quizId) {
        throw new Error('Quiz ID is missing');
      }

      // TODO: Get actual app URL from Shopify app proxy or configuration
      // For now, attempt to fetch from current domain
      const apiUrl = `${API_BASE_URL}/api/quiz/${quizId}`;

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Quiz not found or not active');
        }
        throw new Error(`Failed to load quiz: ${response.status}`);
      }

      quizData = await response.json();

      // Fallback: If API call fails, use simulated data for testing
      // TODO: Remove this fallback once API is properly configured
      if (!quizData || !quizData.questions) {
        console.warn('Using fallback quiz data');
        quizData = {
        id: quizId,
        title: 'Find Your Perfect Products',
        description: 'Answer a few questions to discover products tailored to your needs',
        questions: [
          {
            id: '1',
            text: 'What are you looking for?',
            type: 'multiple_choice',
            options: [
              { id: 'o1', text: 'Something for everyday use' },
              { id: 'o2', text: 'A special occasion item' },
              { id: 'o3', text: 'A gift for someone' },
              { id: 'o4', text: 'Something to treat myself' },
            ]
          },
          {
            id: '2',
            text: "What's your budget?",
            type: 'multiple_choice',
            options: [
              { id: 'o5', text: 'Under $50' },
              { id: 'o6', text: '$50 - $100' },
              { id: 'o7', text: '$100 - $200' },
              { id: 'o8', text: 'Over $200' },
            ]
          },
          {
            id: '3',
            text: 'What style appeals to you?',
            type: 'multiple_choice',
            options: [
              { id: 'o9', text: 'Modern & Minimal' },
              { id: 'o10', text: 'Classic & Timeless' },
              { id: 'o11', text: 'Bold & Trendy' },
              { id: 'o12', text: 'Natural & Organic' },
            ]
          }
        ],
        settings: {
          emailCapture: true,
          resultPageTitle: 'Your Perfect Products'
        }
      }

      loadingEl.style.display = 'none';
      contentEl.style.display = 'block';

      renderQuestion();
      updateProgress();
      setupEventListeners();

    } catch (error) {
      console.error('Failed to load quiz:', error);
      loadingEl.style.display = 'none';
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
      productEl.innerHTML = `
        <img src="${product.imageUrl || product.image}" alt="${product.title}" />
        <div class="result-product-info">
          <div class="result-product-title">${product.title}</div>
          <div class="result-product-price">${product.price}</div>
          <button class="result-product-btn" onclick="window.location.href='${product.url}'">
            View Product
          </button>
        </div>
      `;
      productsContainer.appendChild(productEl);
    });
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

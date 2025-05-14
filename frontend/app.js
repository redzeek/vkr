let cart = JSON.parse(localStorage.getItem('cart')) || [];
let allBooks = [];
let cartBooks = [];
let cartEventInitialized = false;
let currentUser = JSON.parse(localStorage.getItem('currentUser')) || null;
let currentPage = 1;
const booksPerPage = 8;
let authDropdownVisible = false;
let ordersDropdownVisible = false;

function toggleAuthDropdown() {
    const dropdown = document.getElementById('auth-dropdown');
    authDropdownVisible = !authDropdownVisible;
    dropdown.style.display = authDropdownVisible ? 'block' : 'none';
}
async function toggleOrdersDropdown() {
    const dropdown = document.getElementById('orders-dropdown');
    if (!dropdown) return;
    
    ordersDropdownVisible = !ordersDropdownVisible;
    dropdown.style.display = ordersDropdownVisible ? 'block' : 'none';
    
    if (ordersDropdownVisible) {
        try {
            const orders = await (currentUser.role === 'admin' || currentUser.role === 'employee' 
                ? loadAllOrders() 
                : loadUserOrders());
            renderOrders(orders);
        } catch (error) {
            console.error('Ошибка загрузки заказов:', error);
            const ordersList = document.getElementById('orders-list');
            if (ordersList) {
                ordersList.innerHTML = `<p class="error">Ошибка загрузки заказов: ${error.message}</p>`;
            }
        }
    }
}

function renderOrders(orders) {
    const ordersContainer = document.getElementById('orders-list');
    if (!ordersContainer) return;
    
    if (orders.length === 0) {
        ordersContainer.innerHTML = '<p>Нет заказов</p>';
        return;
    }
    
    let html = '';
    orders.forEach(order => {
        html += `
            <div class="order-item">
                <div class="order-header" onclick="toggleOrderDetails(${order.id})">
                    <span class="order-id">Заказ #${order.id}</span>
                    <span class="order-date">${new Date(order.order_date).toLocaleString()}</span>
                    <span class="order-status ${order.status}">${translateOrderStatus(order.status)}</span>
                    <span class="order-total">${order.total_amount.toFixed(2)} руб.</span>
                </div>
                <div class="order-details" id="order-details-${order.id}" style="display:none;">
                    <h5>Товары:</h5>
                    <ul class="order-items">
                        ${order.items.map(item => `
                            <li>
                                ${item.title} (${item.author_name}) - 
                                ${item.quantity} × ${item.price_at_purchase.toFixed(2)} руб.
                            </li>
                        `).join('')}
                    </ul>
                    ${currentUser.role === 'admin' || currentUser.role === 'employee' 
                        ? `<div class="order-actions">
                            <select id="status-select-${order.id}">
                                <option value="processing" ${order.status === 'processing' ? 'selected' : ''}>В обработке</option>
                                <option value="shipped" ${order.status === 'shipped' ? 'selected' : ''}>Отправлен</option>
                                <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>Доставлен</option>
                                <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Отменен</option>
                            </select>
                            <button onclick="updateOrderStatus(${order.id})">Обновить</button>
                        </div>`
                        : ''}
                </div>
            </div>
        `;
    });
    
    ordersContainer.innerHTML = html;
}

function translateOrderStatus(status) {
    const statuses = {
        'processing': 'В обработке',
        'shipped': 'Отправлен',
        'delivered': 'Доставлен',
        'cancelled': 'Отменен'
    };
    return statuses[status] || status;
}

function toggleOrderDetails(orderId) {
    const details = document.getElementById(`order-details-${orderId}`);
    details.style.display = details.style.display === 'none' ? 'block' : 'none';
}

async function updateOrderStatus(orderId) {
    const newStatus = document.getElementById(`status-select-${orderId}`).value;
    
    try {
        const response = await fetch(`http://localhost:5000/api/orders/${orderId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });

        if (!response.ok) {
            throw new Error(await response.text());
        }

        // После успешного обновления - перезагружаем данные заказа
        const orders = currentUser.role === 'admin' || currentUser.role === 'employee' 
            ? await loadAllOrders() 
            : await loadUserOrders();
        
        renderOrders(orders); // Полностью перерисовываем список
        
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Не удалось обновить статус: ' + error.message);
    }
}

function isCartAvailable() {
  if (cart.length === 0) return false;
  
  for (const item of cart) {
    const book = allBooks.find(b => b.id === item.bookId);
    if (!book || item.quantity > book.quantity_in_stock) {
      return false;
    }
  }
  return true;
}

function saveCart() {
    if (currentUser) {
        localStorage.setItem(`cart_${currentUser.id}`, JSON.stringify(cart));
    } else {
        localStorage.removeItem('cart');
    }
}

function addToCart(bookId) {
    if (!currentUser) {
        alert('Для добавления товаров в корзину необходимо авторизоваться');
        toggleAuthDropdown();
        return;
    }
    
    bookId = parseInt(bookId);
    const existingItem = cart.find(item => item.bookId === bookId);
    
    if (existingItem) return;
    
    cart.push({ bookId, quantity: 1 });
    saveCart();
    updateCartUI();
    updateBookButtons();
}


function removeFromCart(bookId) {
    bookId = parseInt(bookId);
    cart = cart.filter(item => item.bookId !== bookId);
    saveCart();
    updateCartUI();
    updateBookButtons();
}
async function checkout() {
    if (!currentUser || cart.length === 0) return;
    
    try {
        const orderData = {
            user_id: currentUser.id,
            total_amount: parseFloat(document.getElementById('cart-total-price').textContent),
            items: cart.map(item => ({
                book_id: item.bookId,
                quantity: item.quantity
            }))
        };

        const response = await fetch('http://localhost:5000/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderData)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Ошибка при оформлении заказа');
        }

        cart = [];
        saveCart();
        updateCartUI();
        updateBookButtons();
        
        alert(`Заказ #${result.order_id} успешно оформлен! Дата: ${new Date(result.order_date).toLocaleString()}\nСумма: ${result.total_amount.toFixed(2)} руб.\nСтатус: ${translateOrderStatus(result.status)}`);
        loadUserOrders();
        
    } catch (error) {
        console.error('Ошибка оформления заказа:', error);
        alert(error.message);
    }
}

function updateCartUI() {
    const cartItemsEl = document.getElementById('cart-items');
    const totalPriceEl = document.getElementById('cart-total-price');
    

    if (!cartItemsEl) return;
    

    if (!currentUser || cart.length === 0) {
        cartItemsEl.innerHTML = currentUser ? '<p>Корзина пуста</p>' : '<p>Авторизуйтесь для работы с корзиной</p>';
        totalPriceEl.textContent = '0';
        document.getElementById('checkout-button').style.display = 'none';
        return;
    }

    const scrollPosition = cartItemsEl.scrollTop;

    let html = '';
    let totalPrice = 0;

    cart.forEach(item => {
        const book = allBooks.find(b => b.id === item.bookId);
        if (!book) return;

        const itemTotal = book.price * item.quantity;
        totalPrice += itemTotal;
        
        html += `
            <div class="cart-item" data-book-id="${book.id}">
                <div class="cart-item-controls">
                    <button class="cart-quantity-btn decrease-btn">-</button>
                    <span class="quantity">${item.quantity}</span>
                    <button class="cart-quantity-btn increase-btn">+</button>
                </div>
                <div class="cart-item-info">
                    <span class="title">${book.title}</span>
                    <span class="price">${itemTotal.toFixed(2)} руб.</span>
                    ${item.quantity > book.quantity_in_stock ? 
                        `<span class="warning">(Доступно: ${book.quantity_in_stock} шт.)</span>` : ''}
                </div>
                <button class="remove-btn">×</button>
            </div>
        `;
    });

    cartItemsEl.innerHTML = html;
    totalPriceEl.textContent = totalPrice.toFixed(2);
    
    cartItemsEl.scrollTop = scrollPosition;
    
  const checkoutBtn = document.getElementById('checkout-button');
  const isEmpty = cart.length === 0;
  const isAvailable = !isEmpty && isCartAvailable();
  
  checkoutBtn.classList.remove('empty-cart', 'unavailable-items');
  
  if (isEmpty) {
    checkoutBtn.disabled = true;
    checkoutBtn.classList.add('empty-cart');
    checkoutBtn.title = 'Корзина пуста';
  } 
  else if (!isAvailable) {
    checkoutBtn.disabled = true;
    checkoutBtn.classList.add('unavailable-items');
    checkoutBtn.title = 'Некоторые товары недоступны в нужном количестве';
  }
  else {
    checkoutBtn.disabled = false;
    checkoutBtn.title = 'Оформить заказ';
  }

  checkoutBtn.style.cursor = checkoutBtn.disabled ? 'not-allowed' : 'pointer';
  document.getElementById('checkout-button').style.display = 'block';
  setupCartEventHandlers();
}

function updateBookButtons() {
    document.querySelectorAll('.add-to-cart').forEach(button => {
        const bookId = parseInt(button.dataset.bookId);
        const inCart = currentUser && cart.some(item => item.bookId === bookId);
        
        button.textContent = inCart ? 'В корзине' : 'В корзину';
        button.disabled = !!inCart;
        button.style.opacity = inCart ? '0.7' : '1';
        button.style.cursor = inCart ? 'default' : 'pointer';
    });
}
function setupCartEventHandlers() {
    const cartContainer = document.getElementById('cart-container');
    if (!cartContainer) return;

    cartContainer.replaceWith(cartContainer.cloneNode(true));
    
    document.getElementById('cart-container').addEventListener('click', function(e) {
        const cartItem = e.target.closest('.cart-item');
        if (!cartItem || !currentUser) return;
        
        const bookId = parseInt(cartItem.dataset.bookId);
        const item = cart.find(item => item.bookId === bookId);
        
        if (!item) return;

        if (e.target.classList.contains('decrease-btn')) {
            item.quantity = Math.max(1, item.quantity - 1);
            saveCart();
            updateCartUI();
        }
        else if (e.target.classList.contains('increase-btn')) {
            item.quantity += 1;
            saveCart();
            updateCartUI();
        }
        else if (e.target.classList.contains('remove-btn')) {
            cart = cart.filter(i => i.bookId !== bookId);
            saveCart();
            updateCartUI();
            updateBookButtons();
        }
    });
}

async function loadBooks(page = 1) {
    currentPage = page;
    const search = document.getElementById('search-input').value;
    const container = document.getElementById('books-container');
    container.innerHTML = '<p>Загрузка...</p>';

    try {
        const response = await fetch(
            `http://localhost:5000/api/books?search=${encodeURIComponent(search)}&page=${page}&per_page=${booksPerPage}`
        );
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Ошибка загрузки книг');
        }

        allBooks = data.books;
        renderBooks(data.books, data.pagination);
    } catch (error) {
        console.error('Error loading books:', error);
        container.innerHTML = `<p class="error">Ошибка загрузки: ${error.message}</p>`;
    }
}
function renderBooks(books, pagination) {
    const container = document.getElementById('books-container');
    let html = '';

    books.forEach(book => {
        const inCart = cart.some(item => item.bookId === book.id);
        const canEdit = currentUser && (currentUser.role === 'admin' || currentUser.role === 'employee');
        
        html += `
        <div class="book-card">
            <h3 onclick="showBookModal(${book.id})" style="cursor: pointer;">${book.title}</h3>
            <p>Автор: ${book.author_name || 'Неизвестен'}</p>
            <p class="price">${book.price} руб.</p>
            <p class="stock">На складе: ${book.quantity_in_stock} шт.</p>
            <button class="info-btn" onclick="showBookModal(${book.id})">Подробнее</button>
            <button class="add-to-cart" data-book-id="${book.id}" ${inCart ? 'disabled' : ''}>
                ${inCart ? 'В корзине' : 'В корзину'}
            </button>
            ${canEdit ? `<button class="edit-btn" onclick="showEditBookForm(${book.id})">Редактировать</button>` : ''}
        </div>
        `;
    });

    if (pagination.total_pages > 1) {
        html += `<div class="pagination">`;
        
        if (pagination.current_page > 1) {
            html += `<button onclick="loadBooks(${pagination.current_page - 1})">&lt; Назад</button>`;
        }
        
        for (let i = 1; i <= pagination.total_pages; i++) {
            if (i === pagination.current_page) {
                html += `<span class="current-page">${i}</span>`;
            } else {
                html += `<button onclick="loadBooks(${i})">${i}</button>`;
            }
        }
        
        if (pagination.current_page < pagination.total_pages) {
            html += `<button onclick="loadBooks(${pagination.current_page + 1})">Вперед &gt;</button>`;
        }
        
        html += `</div>`;
    }

    container.innerHTML = html;

    document.querySelectorAll('.add-to-cart').forEach(button => {
        button.addEventListener('click', function() {
            addToCart(this.dataset.bookId);
        });
    });
}

function loadCart() {
    if (currentUser) {
        try {
            const savedCart = localStorage.getItem(`cart_${currentUser.id}`);
            cart = savedCart ? JSON.parse(savedCart) : [];
            updateCartUI();
            updateBookButtons();
        } catch (e) {
            console.error("Ошибка загрузки корзины:", e);
            cart = [];
            updateCartUI();
        }
    } else {
        cart = [];
        updateCartUI();
    }
}

function logout() {
    if (currentUser) {
        localStorage.removeItem(`cart_${currentUser.id}`);
        saveCart();
    }
    currentUser = null;
    localStorage.removeItem('currentUser');
    cart = [];
    updateAuthUI();
    updateCartUI();
    updateBookButtons();
    window.location.reload();
}

let isLoginMode = true;

function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    const title = document.getElementById('auth-title');
    const emailField = document.getElementById('auth-email');
    const submitBtn = document.getElementById('auth-submit');
    const toggleBtn = document.getElementById('auth-toggle');

    if (isLoginMode) {
        title.textContent = 'Вход';
        emailField.style.display = 'none';
        submitBtn.textContent = 'Войти';
        toggleBtn.textContent = 'Регистрация';
    } else {
        title.textContent = 'Регистрация';
        emailField.style.display = 'block';
        submitBtn.textContent = 'Регистрация';
        toggleBtn.textContent = 'Войти';
    }
}

async function handleAuth() {
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    const email = document.getElementById('auth-email').value.trim();

    if (!username || !password) {
        alert('Имя пользователя и пароль обязательны!');
        return;
    }
    if (!isLoginMode && !email) {
        alert('Email обязателен для регистрации!');
        return;
    }

    try {
        const url = `http://localhost:5000/api/${isLoginMode ? 'login' : 'register'}`;
        const body = isLoginMode 
            ? { username, password } 
            : { username, email, password };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Ошибка сервера');
        }

        if (isLoginMode) {
            currentUser = result;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            loadCart();
            updateAuthUI();
            updateCartUI();
            updateBookButtons();
            alert(`Добро пожаловать, ${username}!`);
            window.location.reload();
        } else {
            alert('Регистрация успешна! Теперь войдите.');
            toggleAuthMode();
            clearAuthFields();
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert(error.message || 'Произошла ошибка');
    }
}

async function loadUserOrders() {
    if (!currentUser) return;
    
    try {
        const response = await fetch(`http://localhost:5000/api/orders/user/${currentUser.id}`);
        const orders = await response.json();
        
        if (!response.ok) {
            throw new Error(orders.error || 'Ошибка загрузки заказов');
        }
        
        return orders;
        
    } catch (error) {
        console.error('Ошибка загрузки заказов:', error);
        return [];
    }
}
function clearAuthFields() {
    document.getElementById('auth-username').value = '';
    document.getElementById('auth-password').value = '';
    document.getElementById('auth-email').value = '';
}

function showAdminPanel() {
    const adminPanel = document.getElementById('admin-panel');
    if (!adminPanel) return;
    
    let html = `
        <h3>${currentUser.role === 'admin' ? 'Панель администратора' : 'Панель сотрудника'}</h3>
    `;
    
    if (currentUser.role === 'admin') {
        html += `
            <div class="admin-section">
                <h4>Управление ролями</h4>
                <div class="role-controls">
                    <input type="text" id="username-input" placeholder="Имя пользователя">
                    <select id="role-select">
                        <option value="customer">Покупатель</option>
                        <option value="employee">Сотрудник</option>
                        <option value="admin">Администратор</option>
                    </select>
                    <button onclick="updateUserRole()">Изменить роль</button>
                </div>
                <div id="role-update-result"></div>
                
                <h4>Список пользователей</h4>
                <button onclick="loadUsersList()">Обновить список</button>
                <div id="users-list"></div>
            </div>
        `;
    }
    
    if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'employee')) {
        html += `
            <div class="admin-section">
                <h4>Управление книгами</h4>
                <button onclick="showAddBookForm()">Добавить новую книгу</button>
                <div id="book-management-container"></div>
            </div>
        `;
    }
    
    adminPanel.innerHTML = html;
}

async function loadAllOrders() {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'employee')) return [];
    
    try {
        const response = await fetch('http://localhost:5000/api/orders');
        const orders = await response.json();
        
        if (!response.ok) {
            throw new Error(orders.error || 'Ошибка загрузки заказов');
        }
        
        return orders;
        
    } catch (error) {
        console.error('Ошибка загрузки заказов:', error);
        return [];
    }
}
async function updateUserRole() {
    const username = document.getElementById('username-input').value.trim();
    const newRole = document.getElementById('role-select').value;
    const resultDiv = document.getElementById('role-update-result');
    
    if (!username) {
        resultDiv.innerHTML = '<p class="error">Введите имя пользователя</p>';
        return;
    }
    
    try {
        const response = await fetch('http://localhost:5000/api/update-role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, new_role: newRole })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Ошибка обновления роли');
        }
        
        resultDiv.innerHTML = `
            <p class="success">Роль успешно обновлена</p>
            <p>Пользователь: ${result.user.username}</p>
            <p>Новая роль: ${translateRole(result.user.role)}</p>
        `;
        
        loadUsersList();
        
    } catch (error) {
        console.error('Ошибка обновления роли:', error);
        resultDiv.innerHTML = `<p class="error">${error.message}</p>`;
    }
}

async function loadUsersList() {
    const usersListDiv = document.getElementById('users-list');
    if (!usersListDiv) return;
    
    try {
        const response = await fetch('http://localhost:5000/api/users');
        const users = await response.json();
        
        if (!response.ok) {
            throw new Error(users.error || 'Ошибка загрузки пользователей');
        }
        
        let html = '<table class="users-table"><tr><th>ID</th><th>Имя</th><th>Email</th><th>Роль</th></tr>';
        users.forEach(user => {
            html += `
                <tr>
                    <td>${user.id}</td>
                    <td>${user.username}</td>
                    <td>${user.email || '-'}</td>
                    <td>${translateRole(user.role)}</td>
                </tr>
            `;
        });
        html += '</table>';
        
        usersListDiv.innerHTML = html;
        
    } catch (error) {
        console.error('Ошибка загрузки пользователей:', error);
        usersListDiv.innerHTML = `<p class="error">${error.message}</p>`;
    }
}


function showBookManagementPanel() {
    const adminPanel = document.getElementById('admin-panel');
    if (!adminPanel) return;
    
    adminPanel.innerHTML += `
        <div class="admin-section">
            <h4>Управление книгами</h4>
            <button onclick="showAddBookForm()">Добавить новую книгу</button>
            <div id="book-management-container"></div>
        </div>
    `;
}

function showBookModal(bookId) {
    const book = allBooks.find(b => b.id === bookId);
    if (!book) return;

    fetch(`http://localhost:5000/api/books/${bookId}`)
        .then(response => response.json())
        .then(fullBook => {
            console.log('Full book data:', fullBook);
            
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content book-modal">
                    <span class="close-btn" onclick="closeModal()">&times;</span>
                    <h2>${fullBook.title || 'Название не указано'}</h2>
                    <div class="book-modal-content">
                        <div class="book-modal-info">
                            <p><strong>Автор:</strong> ${fullBook.author_name || 'Неизвестен'}</p>
                            <p><strong>Цена:</strong> ${fullBook.price ? fullBook.price + ' руб.' : 'Цена не указана'}</p>
                            <p><strong>На складе:</strong> ${fullBook.quantity_in_stock || 0} шт.</p>
                            ${fullBook.publication_date ? `<p><strong>Дата публикации:</strong> ${new Date(fullBook.publication_date).toLocaleDateString()}</p>` : ''}
                            ${fullBook.genres && fullBook.genres.length > 0 ? `<p><strong>Жанры:</strong> ${fullBook.genres.join(', ')}</p>` : ''}
                            ${fullBook.description ? `<div class="book-modal-description"><strong>Описание:</strong><p>${fullBook.description}</p></div>` : ''}
                        </div>
                    </div>
                    <div class="book-modal-actions">
                        <button class="add-to-cart" data-book-id="${fullBook.id}" ${cart.some(item => item.bookId === fullBook.id) ? 'disabled' : ''}>
                            ${cart.some(item => item.bookId === fullBook.id) ? 'В корзине' : 'В корзину'}
                        </button>
                        ${(currentUser && (currentUser.role === 'admin' || currentUser.role === 'employee')) ? 
                            `<button class="edit-btn" onclick="showEditBookForm(${fullBook.id})">Редактировать</button>` : ''}
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            document.body.style.overflow = 'hidden';

            const addToCartBtn = modal.querySelector('.add-to-cart');
            if (addToCartBtn) {
                addToCartBtn.addEventListener('click', function() {
                    addToCart(this.dataset.bookId);
                    this.textContent = 'В корзине';
                    this.disabled = true;
                    closeModal();
                });
            }
        })
        .catch(error => {
            console.error('Ошибка загрузки информации о книге:', error);
            alert('Не удалось загрузить полную информацию о книге');
        });
}

function closeModal() {
    const modal = document.querySelector('.modal');
    if (modal) {
        modal.remove();
        document.body.style.overflow = 'auto';
    }
}

async function showAddBookForm() {
    const [authors, genres] = await Promise.all([
        fetch('http://localhost:5000/api/authors').then(res => res.json()),
        fetch('http://localhost:5000/api/genres').then(res => res.json())
    ]);

    const container = document.getElementById('book-management-container');
    container.innerHTML = `
        <div class="book-form">
            <h5>Добавить новую книгу</h5>
            <div class="form-group">
                <label>Название:</label>
                <input type="text" id="book-title" required>
            </div>
            <div class="form-group">
                <label>Автор:</label>
                <div class="author-selector">
                    <input type="text" id="author-search" placeholder="Поиск автора...">
                    <div id="author-results" class="dropdown-results"></div>
                    <input type="hidden" id="book-author-id">
                    <button onclick="showAddAuthorForm()">Добавить нового автора</button>
                </div>
            </div>
            <div class="form-group">
                <label>Цена:</label>
                <input type="number" step="0.01" id="book-price" required>
            </div>
            <div class="form-group">
                <label>Количество на складе:</label>
                <input type="number" id="book-quantity" required>
            </div>
            <div class="form-group">
                <label>Описание:</label>
                <textarea id="book-description"></textarea>
            </div>
            <div class="form-group">
                <label>Дата публикации:</label>
                <input type="date" id="book-pub-date">
            </div>
            <div class="form-group">
                <label>Жанры:</label>
                <div class="genre-selector">
                    ${genres.map(genre => `
                        <label class="genre-checkbox">
                            <input type="checkbox" name="genres" value="${genre.id}">
                            ${genre.name}
                        </label>
                    `).join('')}
                </div>
            </div>
            <button onclick="addNewBook()">Добавить книгу</button>
            <div id="book-form-result"></div>
        </div>
    `;

    document.getElementById('author-search').addEventListener('input', async function() {
        const searchTerm = this.value.trim();
        if (searchTerm.length < 2) {
            document.getElementById('author-results').innerHTML = '';
            return;
        }

        const response = await fetch(`http://localhost:5000/api/authors/search?name=${encodeURIComponent(searchTerm)}`);
        const authors = await response.json();

        const resultsHtml = authors.map(author => `
            <div class="author-result" onclick="selectAuthor(${author.id}, '${author.name.replace(/'/g, "\\'")}')">
                ${author.name}
            </div>
        `).join('');

        document.getElementById('author-results').innerHTML = resultsHtml;
    });
}

function selectAuthor(id, name) {
    document.getElementById('book-author-id').value = id;
    document.getElementById('author-search').value = name;
    document.getElementById('author-results').innerHTML = '';
}

function showAddAuthorForm() {
    const container = document.getElementById('book-management-container');
    container.innerHTML += `
        <div class="modal" id="author-modal">
            <div class="modal-content">
                <span class="close-btn" onclick="closeAuthorModal()">&times;</span>
                <h4>Добавить нового автора</h4>
                <div class="form-group">
                    <label>Имя автора:</label>
                    <input type="text" id="author-name" required>
                </div>
                <button onclick="addNewAuthor()">Добавить автора</button>
                <div id="author-form-result"></div>
            </div>
        </div>
    `;
}

async function addNewAuthor() {
    const name = document.getElementById('author-name').value.trim();
    
    if (!name) {
        document.getElementById('author-form-result').innerHTML = '<p class="error">Имя автора обязательно</p>';
        return;
    }

    try {
        const response = await fetch('http://localhost:5000/api/authors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Ошибка при добавлении автора');
        }

        document.getElementById('author-form-result').innerHTML = '<p class="success">Автор успешно добавлен!</p>';
        document.getElementById('book-author-id').value = result.id;
        document.getElementById('author-search').value = name;
        closeAuthorModal();
    } catch (error) {
        console.error('Ошибка добавления автора:', error);
        document.getElementById('author-form-result').innerHTML = `<p class="error">${error.message}</p>`;
    }
}

function closeAuthorModal() {
    const modal = document.getElementById('author-modal');
    if (modal) modal.remove();
}
async function showEditBookForm(bookId) {
    const [book, genres, bookGenres] = await Promise.all([
        fetch(`http://localhost:5000/api/books/${bookId}`).then(res => res.json()),
        fetch('http://localhost:5000/api/genres').then(res => res.json()),
        fetch(`http://localhost:5000/api/books/${bookId}`).then(res => res.json())
    ]);

    const container = document.getElementById('book-management-container');
    container.innerHTML = `
        <div class="book-form">
            <h5>Редактировать книгу: ${book.title}</h5>
            <div class="form-group">
                <label>Название:</label>
                <input type="text" id="book-title" value="${book.title || ''}" required>
            </div>
            <div class="form-group">
                <label>Автор:</label>
                <div class="author-selector">
                    <input type="text" id="author-search" placeholder="Поиск автора..." value="${book.author_name || ''}">
                    <div id="author-results" class="dropdown-results"></div>
                    <input type="hidden" id="book-author-id" value="${book.author_id || ''}">
                    <button onclick="showAddAuthorForm()">Добавить нового автора</button>
                </div>
            </div>
            <div class="form-group">
                <label>Цена:</label>
                <input type="number" step="0.01" id="book-price" value="${book.price || ''}" required>
            </div>
            <div class="form-group">
                <label>Количество на складе:</label>
                <input type="number" id="book-quantity" value="${book.quantity_in_stock || 0}" required>
            </div>
            <div class="form-group">
                <label>Описание:</label>
                <textarea id="book-description">${book.description || ''}</textarea>
            </div>
            <div class="form-group">
                <label>Дата публикации:</label>
                <input type="date" id="book-pub-date" value="${book.publication_date || ''}">
            </div>
            <div class="form-group">
                <label>Жанры:</label>
                <div class="genre-selector">
                    ${genres.map(genre => `
                        <label class="genre-checkbox">
                            <input type="checkbox" name="genres" value="${genre.id}" 
                                ${book.genres && book.genres.includes(genre.name) ? 'checked' : ''}>
                            ${genre.name}
                        </label>
                    `).join('')}
                </div>
            </div>
            <div class="form-actions">
                <button onclick="updateBook(${bookId})">Сохранить изменения</button>
                <button class="danger" onclick="deleteBook(${bookId})">Удалить книгу</button>
                <button onclick="document.getElementById('book-management-container').innerHTML = ''">Отмена</button>
            </div>
            <div id="book-form-result"></div>
        </div>
    `;

    document.getElementById('author-search').addEventListener('input', async function() {
        const searchTerm = this.value.trim();
        if (searchTerm.length < 2) {
            document.getElementById('author-results').innerHTML = '';
            return;
        }

        const response = await fetch(`http://localhost:5000/api/authors/search?name=${encodeURIComponent(searchTerm)}`);
        const authors = await response.json();

        const resultsHtml = authors.map(author => `
            <div class="author-result" onclick="selectAuthor(${author.id}, '${author.name.replace(/'/g, "\\'")}')">
                ${author.name}
            </div>
        `).join('');

        document.getElementById('author-results').innerHTML = resultsHtml;
    });
}

async function addNewBook() {
    const resultDiv = document.getElementById('book-form-result');
    try {
        const genreCheckboxes = document.querySelectorAll('input[name="genres"]:checked');
        const genres = Array.from(genreCheckboxes).map(cb => parseInt(cb.value));

        const newBook = {
            title: document.getElementById('book-title').value,
            author_id: parseInt(document.getElementById('book-author-id').value),
            price: parseFloat(document.getElementById('book-price').value),
            quantity_in_stock: parseInt(document.getElementById('book-quantity').value),
            description: document.getElementById('book-description').value,
            publication_date: document.getElementById('book-pub-date').value,
            genres: genres
        };

        if (!newBook.author_id) {
            throw new Error('Необходимо выбрать автора');
        }

        const response = await fetch('http://localhost:5000/api/books', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newBook)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Ошибка при добавлении книги');
        }

        resultDiv.innerHTML = '<p class="success">Книга успешно добавлена!</p>';
        loadBooks();
    } catch (error) {
        console.error('Ошибка добавления книги:', error);
        resultDiv.innerHTML = `<p class="error">${error.message}</p>`;
    }
}

async function updateBook(bookId) {
    const resultDiv = document.getElementById('book-form-result');
    try {
        const genreCheckboxes = document.querySelectorAll('input[name="genres"]:checked');
        const genres = Array.from(genreCheckboxes).map(cb => parseInt(cb.value));

        const updatedBook = {
            title: document.getElementById('book-title').value,
            author_id: parseInt(document.getElementById('book-author-id').value),
            price: parseFloat(document.getElementById('book-price').value),
            quantity_in_stock: parseInt(document.getElementById('book-quantity').value),
            description: document.getElementById('book-description').value,
            publication_date: document.getElementById('book-pub-date').value,
            genres: genres
        };

        if (!updatedBook.author_id) {
            throw new Error('Необходимо выбрать автора');
        }

        const response = await fetch(`http://localhost:5000/api/books/${bookId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedBook)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Ошибка при обновлении книги');
        }

        resultDiv.innerHTML = '<p class="success">Книга успешно обновлена!</p>';
        loadBooks();
    } catch (error) {
        console.error('Ошибка обновления книги:', error);
        resultDiv.innerHTML = `<p class="error">${error.message}</p>`;
    }
}

async function deleteBook(bookId) {
    if (!confirm('Вы уверены, что хотите удалить эту книгу?')) return;

    try {
        const response = await fetch(`http://localhost:5000/api/books/${bookId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Ошибка при удалении книги');
        }

        alert('Книга успешно удалена!');
        loadBooks();
        document.getElementById('book-management-container').innerHTML = '';
    } catch (error) {
        console.error('Ошибка удаления книги:', error);
        alert(error.message);
    }
}

function translateRole(role) {
    const roles = {
        'customer': 'Покупатель',
        'employee': 'Сотрудник',
        'admin': 'Администратор'
    };
    return roles[role] || role;
}
document.addEventListener('click', function(event) {
    const userPanel = document.getElementById('user-panel');
    const ordersDropdown = document.getElementById('orders-dropdown');
    const ordersButton = document.getElementById('orders-button');
    
    if (ordersDropdown && ordersDropdown.style.display === 'block') {
        if (!ordersDropdown.contains(event.target) && event.target !== ordersButton) {
            ordersDropdown.style.display = 'none';
            ordersDropdownVisible = false;
        }
    }
});

function updateAuthUI() {
    const authButton = document.getElementById('auth-button');
    const userPanel = document.getElementById('user-panel');
    const dropdown = document.getElementById('auth-dropdown');
    
    if (currentUser) {
        authButton.style.display = 'none';
        userPanel.style.display = 'flex';
        dropdown.style.display = 'none';
        authDropdownVisible = false;
        
        userPanel.innerHTML = `
            <span id="current-username">${currentUser.username}</span>
            <button id="orders-button" onclick="toggleOrdersDropdown()">
                ${currentUser.role === 'admin' || currentUser.role === 'employee' ? 'Все заказы' : 'Мои заказы'}
            </button>
            <button onclick="logout()">Выйти</button>
            <div id="orders-dropdown" class="orders-dropdown" style="display:none;">
                <h4>${currentUser.role === 'admin' || currentUser.role === 'employee' ? 'Все заказы' : 'Мои заказы'}</h4>
                <div id="orders-list" class="orders-list"></div>
            </div>
        `;
        
        if (currentUser.role === 'admin' || currentUser.role === 'employee') {
            document.getElementById('admin-panel').style.display = 'block';
            showAdminPanel();
        } else {
            document.getElementById('admin-panel').style.display = 'none';
        }
        
        loadCart();
    } else {
        authButton.style.display = 'block';
        userPanel.style.display = 'none';
        document.getElementById('admin-panel').style.display = 'none';
        cart = [];
        updateCartUI();
        updateBookButtons();
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        updateAuthUI();
    } else {
        cart = [];
    }

    await loadBooks(1);
    loadCart();
    updateCartUI();
    updateBookButtons();
    setupCartEventHandlers();
});


document.addEventListener('click', function(e) {
    if (e.target && e.target.id === 'checkout-button' && !e.target.disabled) {
        checkout();
    }
});
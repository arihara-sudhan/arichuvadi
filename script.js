class BlogApp {
    constructor() {
        this.posts = [];
        this.currentPost = null;
        this.comments = {};
        this.currentTopic = 'ellam';
        this.currentPage = 1;
        this.postsPerPage = 10;
        this.sortedPostsCache = [];
        this.explanations = [];
        this.explanationIndex = new Map();
        this.activeExplanations = {};
        this.translationAvailability = new Map();
        this.siteBasePath = this.detectSiteBasePath();
        
        this.init();
    }

    detectSiteBasePath() {
        try {
            const scriptUrl = document.currentScript?.src
                || Array.from(document.scripts).find(script => script.src && script.src.includes('script.js'))?.src
                || window.location.href;
            const pathname = new URL(scriptUrl, window.location.href).pathname;
            const basePath = pathname.slice(0, pathname.lastIndexOf('/') + 1) || '/';
            return basePath.endsWith('/') ? basePath : `${basePath}/`;
        } catch (error) {
            return '/';
        }
    }

    joinSitePath(path) {
        const cleanPath = String(path ?? '').trim();
        if (!cleanPath || this.isExternalUrl(cleanPath)) {
            return cleanPath;
        }

        const siteBasePath = this.siteBasePath || '/';
        const normalizedPath = cleanPath.replace(/^\/+/, '');

        if (siteBasePath === '/') {
            return `/${normalizedPath}`;
        }

        if (normalizedPath.startsWith(siteBasePath.replace(/^\/+/, ''))) {
            return cleanPath.startsWith('/') ? cleanPath : `/${normalizedPath}`;
        }

        return `${siteBasePath}${normalizedPath}`;
    }

    init() {
        this.loadData();
        this.setupEventListeners();
        window.addEventListener('popstate', () => {
            this.handleRouting();
        });
        this.handleRouting();
        this.explanationsReady = this.loadExplanations();
        this.loadPosts();
    }

    loadData() {
        const savedPosts = localStorage.getItem('blogPosts');
        if (savedPosts) {
            this.posts = JSON.parse(savedPosts);
        }

        const savedComments = localStorage.getItem('blogComments');
        if (savedComments) {
            this.comments = JSON.parse(savedComments);
        }

    }

    saveData() {
        localStorage.setItem('blogPosts', JSON.stringify(this.posts));
        localStorage.setItem('blogComments', JSON.stringify(this.comments));
    }

    async loadExplanations() {
        try {
            const response = await fetch('explanations.json');
            if (response.ok) {
                const data = await response.json();
                this.explanations = this.normalizeExplanations(data);
                this.explanationIndex = this.buildExplanationIndex(this.explanations);
            } else {
                console.warn('Could not load explanations.json:', response.status);
                this.explanations = [];
                this.explanationIndex = new Map();
            }
        } catch (error) {
            console.warn('Error loading explanations.json:', error);
            this.explanations = [];
            this.explanationIndex = new Map();
        }
    }

    normalizeExplanations(data) {
        const rawEntries = Array.isArray(data)
            ? data
            : (data && typeof data === 'object'
                ? Object.entries(data)
                    .filter(([, value]) => value && typeof value === 'object')
                    .map(([key, value]) => ({
                        aliases: key.split('|').map(word => word.trim()).filter(Boolean),
                        ...value
                    }))
                : []);

        return rawEntries
            .filter(entry => entry && typeof entry === 'object')
            .map((entry, index) => {
                const aliases = Array.isArray(entry.aliases)
                    ? entry.aliases
                    : Array.isArray(entry.words)
                        ? entry.words
                        : [];
                const normalizedAliases = aliases
                    .filter(alias => typeof alias === 'string')
                    .map(alias => alias.trim())
                    .filter(Boolean);
                const title = typeof entry.title === 'string' && entry.title.trim()
                    ? entry.title.trim()
                    : normalizedAliases[0] || `Explanation ${index + 1}`;
                const id = typeof entry.id === 'string' && entry.id.trim()
                    ? entry.id.trim()
                    : this.slugifyTerm(title);

                return {
                    ...entry,
                    id,
                    title,
                    aliases: normalizedAliases,
                    words: normalizedAliases
                };
            });
    }

    buildExplanationIndex(entries = []) {
        const index = new Map();

        for (const entry of entries) {
            const lookupTerms = [entry.title, ...(entry.aliases || []), ...(entry.words || [])]
                .filter(term => typeof term === 'string')
                .map(term => this.normalizeTerm(term))
                .filter(Boolean);

            for (const term of lookupTerms) {
                if (!index.has(term)) {
                    index.set(term, entry);
                }
            }
        }

        return index;
    }

    normalizeTerm(term) {
        return String(term ?? '')
            .normalize('NFKC')
            .toLocaleLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    normalizeFolderPath(folder) {
        return String(folder ?? '')
            .trim()
            .replace(/^\.?\//, '')
            .replace(/\/+$/, '');
    }

    getPostCategory(post) {
        const explicitCategory = this.normalizeFolderPath(post?.category);
        if (explicitCategory) {
            return explicitCategory;
        }

        const folder = this.normalizeFolderPath(post?.folder || post?.source_folder || post?.directory);
        if (folder.includes('/')) {
            return folder.split('/')[0];
        }

        return '';
    }

    resolvePostFolderPath(post) {
        const folder = this.normalizeFolderPath(post.folder || post.source_folder || post.directory);
        if (!folder) {
            return '';
        }

        const category = this.getPostCategory(post);

        if (folder.startsWith('posts/')) {
            const legacyFolder = folder.slice('posts/'.length);
            if (category && legacyFolder && !legacyFolder.includes('/')) {
                return `posts/${category}/${legacyFolder}`;
            }
            return folder;
        }

        if (folder.includes('/')) {
            return `posts/${folder}`;
        }

        if (category) {
            return `posts/${category}/${folder}`;
        }

        return `posts/${folder}`;
    }

    isExternalUrl(value) {
        return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:|mailto:|javascript:)/i.test(String(value ?? ''));
    }

    resolveRelativePath(basePath, assetPath) {
        const cleanPath = String(assetPath ?? '').trim();
        if (!cleanPath || this.isExternalUrl(cleanPath)) {
            return cleanPath;
        }

        const normalizedPath = cleanPath.replace(/^\/+/, '');

        const normalizedBase = this.normalizeFolderPath(basePath);
        if (!normalizedBase) {
            return normalizedPath;
        }

        return `${normalizedBase}/${normalizedPath.replace(/^\.?\//, '')}`;
    }

    resolvePostContentPath(post) {
        const folder = this.resolvePostFolderPath(post);
        if (folder) {
            return `${folder}/content.md`;
        }

        const category = this.normalizeFolderPath(post?.category);
        return category ? `posts/${category}/${post.id}.md` : `posts/${post.id}.md`;
    }

    resolvePostTranslationPath(post) {
        const folder = this.resolvePostFolderPath(post);
        const translationPath = post.translated_content || post.translation_content || (folder ? 'translation.md' : '');

        if (!translationPath) {
            return '';
        }

        return this.resolveRelativePath(folder, translationPath);
    }

    async resourceExists(path) {
        if (!path) {
            return false;
        }

        try {
            let response = await fetch(path, { method: 'HEAD' });
            if (response.ok) {
                return true;
            }

            if (response.status === 405 || response.status === 501) {
                response = await fetch(path);
                return response.ok;
            }
        } catch (error) {
            return false;
        }

        return false;
    }

    async annotatePostsWithTranslationStatus(posts = []) {
        await Promise.all(posts.map(async (post) => {
            const translationPath = this.resolvePostTranslationPath(post);
            post.translationPath = translationPath;

            if (!translationPath) {
                post.hasTranslation = false;
                return;
            }

            if (this.translationAvailability.has(translationPath)) {
                post.hasTranslation = this.translationAvailability.get(translationPath);
                return;
            }

            const exists = await this.resourceExists(translationPath);
            this.translationAvailability.set(translationPath, exists);
            post.hasTranslation = exists;
        }));
    }

    getPostImageCandidates(post) {
        const folder = this.normalizeFolderPath(post.folder || post.source_folder || post.directory);
        const folderPath = this.resolvePostFolderPath(post);
        const category = this.getPostCategory(post);
        const candidates = [];

        if (post.image) {
            candidates.push(this.resolveRelativePath(folderPath, post.image));
        }

        if (folder) {
            const leafName = folder.split('/').pop();

            if (category === 'kavithaigal') {
                ['webp', 'png', 'jpg', 'jpeg', 'avif'].forEach(ext => {
                    candidates.push(`${folderPath}/${leafName}.${ext}`);
                });
            } else {
                ['jpg', 'png', 'webp', 'jpeg', 'avif'].forEach(ext => {
                    candidates.push(`${folderPath}/images/cover.${ext}`);
                    candidates.push(`${folderPath}/cover.${ext}`);
                });
            }
        }

        return [...new Set(candidates.filter(Boolean))];
    }

    async annotatePostsWithImagePaths(posts = []) {
        await Promise.all(posts.map(async (post) => {
            if (post.imagePath) {
                return;
            }

            const candidates = this.getPostImageCandidates(post);
            for (const candidate of candidates) {
                if (await this.resourceExists(candidate)) {
                    post.imagePath = candidate;
                    return;
                }
            }

            post.imagePath = '';
        }));
    }

    resolvePostImage(post, imagePath) {
        const folder = this.resolvePostFolderPath(post);
        return this.resolveRelativePath(folder, imagePath);
    }

    resolveExplanationImage(post, imagePath) {
        const cleanPath = String(imagePath ?? '').trim();
        if (!cleanPath) {
            return '';
        }

        if (this.isExternalUrl(cleanPath)) {
            return cleanPath;
        }

        const normalizedPath = cleanPath.replace(/^\/+/, '');

        const folder = this.resolvePostFolderPath(post);
        if (folder) {
            const relativePath = normalizedPath.startsWith('images/') ? normalizedPath : `images/${normalizedPath}`;
            return this.resolveRelativePath(folder, relativePath);
        }

        if (normalizedPath.startsWith('static/') || normalizedPath.startsWith('images/')) {
            return normalizedPath;
        }

        return `static/explanation_images/${normalizedPath}`;
    }

    async fetchTextIfAvailable(path) {
        try {
            const response = await fetch(path);
            if (response.ok) {
                return await response.text();
            }
        } catch (error) {
            return null;
        }

        return null;
    }

    async loadPostExplanations(post) {
        const folder = this.resolvePostFolderPath(post);
        let mergedEntries = [];

        if (folder) {
            const rawFolderExplanations = await this.fetchTextIfAvailable(`${folder}/explanations.json`);
            if (rawFolderExplanations) {
                try {
                    const parsedFolder = JSON.parse(rawFolderExplanations);
                    mergedEntries = this.normalizeExplanations(parsedFolder);
                } catch (error) {
                    console.warn(`Error loading ${folder}/explanations.json:`, error);
                }
            }
        }

        mergedEntries = mergedEntries.concat(this.explanations);
        return {
            entries: mergedEntries,
            index: this.buildExplanationIndex(mergedEntries)
        };
    }

    rewriteRelativePaths(html, basePath) {
        const normalizedBase = this.normalizeFolderPath(basePath);
        if (!normalizedBase) {
            return html;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html');

        doc.querySelectorAll('img[src]').forEach((img) => {
            const src = img.getAttribute('src') || '';
            const resolved = this.resolveRelativePath(normalizedBase, src);
            img.setAttribute('src', resolved);
        });

        doc.querySelectorAll('source[src]').forEach((source) => {
            const src = source.getAttribute('src') || '';
            const resolved = this.resolveRelativePath(normalizedBase, src);
            source.setAttribute('src', resolved);
        });

        doc.querySelectorAll('a[href]').forEach((anchor) => {
            const href = anchor.getAttribute('href') || '';
            const resolved = this.resolveRelativePath(normalizedBase, href);
            anchor.setAttribute('href', resolved);
        });

        return doc.body.innerHTML;
    }

    slugifyTerm(term) {
        return this.normalizeTerm(term)
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'explanation';
    }

    setupEventListeners() {
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.dataset.page;
                this.navigateToPage(page);
            });
        });

        const topicsContainer = document.getElementById('topics');
        if (topicsContainer) {
            topicsContainer.addEventListener('click', (e) => {
                const btn = e.target.closest('.topic-btn');
                if (!btn || !topicsContainer.contains(btn)) return;

                const topic = btn.dataset.topic;
                this.filterByTopic(topic);
            });
        }
    }

    renderTopics() {
        const topicsContainer = document.getElementById('topics');
        if (!topicsContainer) return;

        const topicLabels = {
            ellam: 'எல்லாம்',
            kathaigal: 'கதைகள்',
            verchchol: 'வேர்ச்சொல்',
            katturaigal: 'கட்டுரைகள்',
            kavithaigal: 'கவிதைகள்'
        };

        const availableTopics = Object.keys(topicLabels).filter(topic =>
            topic !== 'ellam' && this.posts.some(post => this.getPostCategory(post) === topic)
        );

        if (this.currentTopic !== 'ellam' && !availableTopics.includes(this.currentTopic)) {
            this.currentTopic = 'ellam';
        }

        const topicButtons = [
            `<button class="topic-btn${this.currentTopic === 'ellam' ? ' active' : ''}" data-topic="ellam">${topicLabels.ellam}</button>`
        ];

        availableTopics.forEach(topic => {
            topicButtons.push('<span class="topic-separator">◇</span>');
            topicButtons.push(
                `<button class="topic-btn${this.currentTopic === topic ? ' active' : ''}" data-topic="${topic}">${topicLabels[topic]}</button>`
            );
        });

        topicsContainer.innerHTML = topicButtons.join('');
    }

    handleRouting() {
        const pathname = window.location.pathname;
        const relativePath = this.siteBasePath !== '/' && pathname.startsWith(this.siteBasePath)
            ? `/${pathname.slice(this.siteBasePath.length)}`
            : pathname;
        const path = relativePath.replace(/\/+$/, '') || '/';
        const parts = path.split('/').filter(Boolean);
        const route = parts[0] || 'all';

        if (route === 'post' && parts[1]) {
            const postId = decodeURIComponent(parts.slice(1).join('/'));
            this.showPost(postId, false);
            return;
        }

        if (route === 'about') {
            this.navigateToPage('about', false);
            return;
        }

        const topic = this.normalizeRouteTopic(route);
        this.currentTopic = topic;
        this.currentPage = 1;
        this.navigateToPage('home', false);

        if (this.posts.length > 0) {
            this.renderTopics();
            this.renderPosts();
        }

        if (path === '/') {
            this.updateBrowserPath('all', true);
        }
    }

    normalizeRouteTopic(route) {
        if (!route || route === 'all') {
            return 'ellam';
        }

        return route;
    }

    getTopicPath(topic) {
        if (!topic || topic === 'ellam') {
            return 'all';
        }

        return topic;
    }

    updateBrowserPath(path, replace = false) {
        const nextPath = this.joinSitePath(path);
        if (replace) {
            window.history.replaceState({ path: nextPath }, '', nextPath);
        } else {
            window.history.pushState({ path: nextPath }, '', nextPath);
        }
    }

    navigateToPage(page, updateUrl = true) {
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
            if (link.dataset.page === page) {
                link.classList.add('active');
            }
        });
        document.querySelectorAll('.page').forEach(p => {
            p.classList.remove('active');
        });

        if (page === 'home') {
            document.getElementById('home-page').classList.add('active');
            if (updateUrl) {
                this.updateBrowserPath(this.getTopicPath(this.currentTopic || 'ellam'));
            }
        } else if (page === 'about') {
            document.getElementById('about-page').classList.add('active');
            if (updateUrl) {
                this.updateBrowserPath('about');
            }
        }
    }

    async loadPosts() {
        try {
            const response = await fetch('posts.json');
            if (response.ok) {
                const postsData = await response.json();
                this.posts = postsData.posts;
                this.saveData();
            }
        } catch (error) {
            console.log('Using default posts or local storage data');
        }

        this.preparePosts(this.posts);
        this.renderTopics();
        this.renderPosts();
    }

    preparePosts(posts = []) {
        posts.forEach((post) => {
            post.folder = this.normalizeFolderPath(post.folder || post.source_folder || post.directory);
            post.category = this.getPostCategory(post);
            post.translationPath = post.translationPath || this.resolvePostTranslationPath(post);
            post.hasTranslation = String(post.translation || '').toLowerCase() === 'yes';
        });

        this.sortedPostsCache = [...posts].sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    getSortedPosts() {
        if (!Array.isArray(this.sortedPostsCache) || this.sortedPostsCache.length !== this.posts.length) {
            this.sortedPostsCache = [...this.posts].sort((a, b) => new Date(b.date) - new Date(a.date));
        }

        return this.sortedPostsCache;
    }

    getDisplayPosts(topic = this.currentTopic) {
        const sortedPosts = this.getSortedPosts();

        if (topic !== 'ellam') {
            return sortedPosts.filter(post => this.getPostCategory(post) === topic);
        }

        const categoryPriority = {
            katturaigal: 0,
            kavithaigal: 1
        };

        return [...sortedPosts].sort((a, b) => {
            const categoryA = this.getPostCategory(a);
            const categoryB = this.getPostCategory(b);
            const priorityA = categoryPriority.hasOwnProperty(categoryA) ? categoryPriority[categoryA] : 99;
            const priorityB = categoryPriority.hasOwnProperty(categoryB) ? categoryPriority[categoryB] : 99;

            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }

            return new Date(b.date) - new Date(a.date);
        });
    }

    getPostNumber(post, topic = this.currentTopic) {
        const displayPosts = this.getDisplayPosts(topic);
        const filteredIndex = displayPosts.findIndex(entry => entry.id === post.id);
        return filteredIndex >= 0 ? `${filteredIndex + 1}. ` : '';
    }

    getDisplayTitle(post, fallbackTitle = '', topic = this.currentTopic) {
        const title = fallbackTitle || post?.title || '';
        const numberPrefix = this.getPostNumber(post, topic);
        return `${numberPrefix}${title}`;
    }

    filterByTopic(topic) {
        this.currentTopic = topic;
        this.currentPage = 1;
        this.navigateToPage('home', true);
        this.renderTopics();
        this.renderPosts();
    }

    renderPosts() {
        const postsGrid = document.getElementById('posts-grid');
        let pagination = document.getElementById('posts-pagination');
        
        if (this.posts.length === 0) {
            postsGrid.innerHTML = '<div class="empty-state">No posts available</div>';
            if (pagination) {
                pagination.innerHTML = '';
                pagination.hidden = true;
            }
            return;
        }

        const filteredPosts = this.getDisplayPosts(this.currentTopic);

        if (filteredPosts.length === 0) {
            postsGrid.innerHTML = '<div class="empty-state">பதிவுகள் இல்லை</div>';
            if (pagination) {
                pagination.innerHTML = '';
                pagination.hidden = true;
            }
            return;
        }

        const totalPages = Math.max(1, Math.ceil(filteredPosts.length / this.postsPerPage));
        this.currentPage = Math.min(this.currentPage, totalPages);
        const startIndex = (this.currentPage - 1) * this.postsPerPage;
        const visiblePosts = filteredPosts.slice(startIndex, startIndex + this.postsPerPage);

        postsGrid.innerHTML = visiblePosts.map(post => {
            const imageSource = post.imagePath || post.image || '';
            const resolvedImage = imageSource ? this.resolvePostImage(post, imageSource) : '';
            const displayTitle = this.getDisplayTitle(post, '', this.currentTopic);

            return `
            <div class="post-card" onclick="blogApp.showPost('${post.id}')">
                ${resolvedImage ? `<img src="${this.escapeHtml(resolvedImage)}" alt="${this.escapeHtml(displayTitle)}" class="post-card-image" loading="lazy" decoding="async" draggable="false">` : ''}
                <div class="post-card-content">
                    <h3>${displayTitle}</h3>
                    <div class="post-card-meta">
                        <span class="post-card-date">${new Date(post.date).toLocaleDateString()}</span>
                        <span class="post-card-language">${post.hasTranslation ? 'தமிழ் & English' : 'தமிழ்'}</span>
                    </div>
                </div>
            </div>
        `}).join('');

        if (!pagination) {
            pagination = document.createElement('div');
            pagination.id = 'posts-pagination';
            pagination.className = 'posts-pagination';
            postsGrid.insertAdjacentElement('afterend', pagination);
        }

        if (totalPages > 1) {
            pagination.hidden = false;
            pagination.innerHTML = `
                <button class="pagination-btn" data-direction="prev" ${this.currentPage === 1 ? 'disabled' : ''}>
                    ← முந்தையவை
                </button>
                <span class="pagination-status">${this.currentPage} / ${totalPages}</span>
                <button class="pagination-btn" data-direction="next" ${this.currentPage === totalPages ? 'disabled' : ''}>
                    அடுத்தவை →
                </button>
            `;

            pagination.onclick = (event) => {
                const btn = event.target.closest('.pagination-btn');
                if (!btn || btn.disabled) return;
                this.goToPostsPage(btn.dataset.direction);
            };
        } else {
            pagination.innerHTML = '';
            pagination.hidden = true;
            pagination.onclick = null;
        }
    }

    goToPostsPage(direction) {
        const filteredPosts = this.getDisplayPosts(this.currentTopic);
        const totalPages = Math.max(1, Math.ceil(filteredPosts.length / this.postsPerPage));

        if (direction === 'prev') {
            this.currentPage = Math.max(1, this.currentPage - 1);
        } else if (direction === 'next') {
            this.currentPage = Math.min(totalPages, this.currentPage + 1);
        }

        this.renderPosts();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async loadPostFromSource(post) {
        const contentPath = this.resolvePostContentPath(post);
        let content = await this.fetchTextIfAvailable(contentPath);

        if (!content && !this.resolvePostFolderPath(post)) {
            content = await this.fetchTextIfAvailable(`https://raw.githubusercontent.com/arihara-sudhan/blog/main/posts/${post.id}.md`);
        }

        if (!content) {
            return null;
        }

        const folder = this.resolvePostFolderPath(post);
        const postExplanations = await this.loadPostExplanations(post);
        const translatedContentPath = this.resolvePostTranslationPath(post);
        const resolvedTitle = this.extractMarkdownTitle(content) || post.title;
        const resolvedTranslatedTitle = translatedContentPath ? await this.resolveTranslatedTitle(translatedContentPath, post) : '';

        return {
            ...post,
            content,
            title: resolvedTitle,
            title_english: resolvedTranslatedTitle || post.title_english,
            folder,
            assetBasePath: folder,
            translated_content: translatedContentPath || post.translated_content,
            explanationIndex: postExplanations.index,
            explanations: postExplanations.entries
        };
    }

    extractMarkdownTitle(content) {
        const lines = String(content ?? '').split('\n');
        if (lines[0]?.startsWith('---')) {
            let i = 1;
            while (i < lines.length && !lines[i].startsWith('---')) {
                const line = lines[i];
                if (line.startsWith('title:')) {
                    return line.substring(6).trim().replace(/['"]/g, '');
                }
                i++;
            }
        }

        const titleMatch = String(content ?? '').match(/^#\s+(.+)$/m);
        return titleMatch ? titleMatch[1].trim() : '';
    }

    async resolveTranslatedTitle(translatedContentPath, post) {
        try {
            const raw = await this.fetchTextIfAvailable(translatedContentPath);
            if (!raw) {
                return '';
            }

            return this.extractMarkdownTitle(raw) || '';
        } catch (error) {
            return '';
        }
    }

    async showPost(postId, updateUrl = true) {
        if (this.explanationsReady) {
            await this.explanationsReady;
        }

        let post = this.posts.find(p => p.id === postId);

        if (post && (!post.content || this.resolvePostFolderPath(post))) {
            try {
                const loadedPost = await this.loadPostFromSource(post);
                if (loadedPost) {
                    post = loadedPost;
                }
            } catch (error) {
                console.error('Error loading post:', error);
                return;
            }
        }

        if (!post) {
            return;
        }

        if (!post.content) {
            return;
        }

        this.currentPost = post;
        this.renderPost(post);
        this.navigateToPost(postId, updateUrl);
    }

    setupTranslateButton(post) {
        const translateBtn = document.getElementById('translate-btn');
        if (!translateBtn) return;

        if (post && post.translation && post.translation.toString().toLowerCase() === 'yes') {
            translateBtn.style.display = 'inline-block';
            const isEnglish = !!post.isEnglish;
            translateBtn.setAttribute('aria-label', isEnglish ? 'Show Tamil original' : 'Show English translation');
            translateBtn.setAttribute('title', isEnglish ? 'Show Tamil original' : 'Show English translation');

            translateBtn.onclick = async () => {
                const currentlyEnglish = !!post.isEnglish;
                if (currentlyEnglish) {
                    post.isEnglish = false;
                    this.renderPost(post);
                    return;
                }

                if (post.translatedContent) {
                    post.isEnglish = true;
                    this.renderPost(post);
                    return;
                }

                const translatedSource = post.translationPath || this.resolvePostTranslationPath(post) || post.translated_content || post.translation_content;
                if (!translatedSource) {
                    alert('Translation source not available for this post yet.');
                    return;
                }

                try {
                    const response = await fetch(translatedSource);
                    if (!response.ok) {
                        throw new Error(`Could not load translation: ${response.status}`);
                    }
                    const raw = await response.text();
                    post.translatedContent = raw;

                    if (!post.title_english) {
                        post.title_english = this.extractMarkdownTitle(raw) || post.title;
                    }

                    post.isEnglish = true;
                    this.renderPost(post);
                } catch (error) {
                    console.error('Translation load failed:', error);
                    alert('Failed to load translated content.');
                }
            };
        } else {
            translateBtn.style.display = 'none';
            translateBtn.setAttribute('aria-label', 'Translate post');
            translateBtn.setAttribute('title', 'Translate post');
            translateBtn.onclick = null;
        }
    }

    applyExplanations(content, language, post) {
        this.activeExplanations = {};
        let explanationIndex = 0;
        const explanationIndexMap = post?.explanationIndex || this.explanationIndex;

        return content.replace(/<qn>([\s\S]*?)<\/qn>/gu, (_, rawTerm) => {
            const target = rawTerm.trim();
            if (!target) return rawTerm;

            const normalizedTarget = this.normalizeTerm(target);
            const entry = explanationIndexMap?.get(normalizedTarget) || null;

            if (!entry) {
                return this.escapeHtml(target);
            }

            const explanationId = `expl-${explanationIndex++}`;
            this.activeExplanations[explanationId] = {
                ...entry,
                _id: explanationId,
                _target: target
            };

            return `<span class="expl-term" data-expl-id="${this.escapeHtml(explanationId)}">${this.escapeHtml(target)}<sup>?</sup></span>`;
        });
    }

    setupExplanationLinks(language, post) {
        const explainCard = document.getElementById('explain-card');
        const explainCardContent = document.getElementById('explain-card-content');
        const closeBtn = document.getElementById('explain-card-close');

        if (!explainCard || !explainCardContent || !closeBtn) return;

        document.querySelectorAll('.expl-term').forEach((el) => {
            el.addEventListener('click', () => {
                const id = el.getAttribute('data-expl-id');
                if (!id) return;

                const entry = Object.values(this.activeExplanations || {}).find(e => e._id === id);
                if (!entry) return;

                document.querySelectorAll('.expl-term').forEach(x => x.classList.remove('active'));
                el.classList.add('active');

                const imageHtml = entry.image
                    ? `<img class="explain-card-image" src="${this.escapeHtml(this.resolveExplanationImage(post, entry.image))}" alt="${this.escapeHtml(entry[language] || entry.title || '')}" draggable="false"/>`
                    : '';
                const text = this.escapeHtml(entry[language] || 'No explanation found');

                explainCardContent.innerHTML = `${imageHtml}<p>${text}</p>`;
                explainCard.hidden = false;
                explainCard.classList.add('visible');
            });
        });

        closeBtn.onclick = () => {
            explainCard.hidden = true;
            explainCard.classList.remove('visible');
        };

        document.addEventListener('click', (event) => {
            if (!explainCard.classList.contains('visible')) return;
            const target = event.target;
            if (target.closest('.explain-card') || target.closest('.expl-term')) return;

            explainCard.hidden = true;
            explainCard.classList.remove('visible');
        });

        window.addEventListener('scroll', () => {
            if (!explainCard.classList.contains('visible')) return;

            const activeTerm = document.querySelector('.expl-term.active');
            if (!activeTerm) {
                explainCard.hidden = true;
                explainCard.classList.remove('visible');
                return;
            }

            const rect = activeTerm.getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > window.innerHeight) {
                explainCard.hidden = true;
                explainCard.classList.remove('visible');
            }
        }, { passive: true });
    }

    parseMarkdownPost(content, postId) {
        return {
            id: postId,
            title: this.extractMarkdownTitle(content) || 'Untitled Post',
            content: content,
            excerpt: this.generateExcerpt(content)
        };
    }

    generateExcerpt(content) {
        const plainText = content
            .replace(/^#+\s+/gm, '')
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/\*(.*?)\*/g, '$1')
            .replace(/`(.*?)`/g, '$1')
            .replace(/\[(.*?)\]\(.*?\)/g, '$1')
            .replace(/!\[.*?\]\(.*?\)/g, '')
            .trim();
        
        return plainText.length > 150 ? plainText.substring(0, 150) + '...' : plainText;
    }

    renderPost(post) {
        const postTitleElement = document.getElementById('post-title');
        const isEnglish = post.isEnglish;
        const baseTitle = isEnglish
            ? (post.title_english || post.title)
            : post.title;
        postTitleElement.textContent = this.getDisplayTitle(post, baseTitle, this.currentTopic);
        
        // Add hr after title if it doesn't exist
        const nextEl = postTitleElement.nextElementSibling;
        if (!nextEl || nextEl.tagName !== 'HR') {
            const hr = document.createElement('hr');
            postTitleElement.parentNode.insertBefore(hr, postTitleElement.nextSibling);
        }
        
        const contentToRender = isEnglish
            ? (post.translatedContent || post.content)
            : post.content;

        const postContentElement = document.getElementById('post-content');
        const isPoem = this.getPostCategory(post) === 'kavithaigal';

        if (isPoem) {
            postContentElement.innerHTML = this.renderRawMarkdownWithImages(
                contentToRender,
                post.assetBasePath || this.resolvePostFolderPath(post) || ''
            );
        } else {
            const annotatedContent = this.applyExplanations(contentToRender, isEnglish ? 'english' : 'tamil', post);
            const renderedContent = marked.parse(annotatedContent);
            postContentElement.innerHTML = this.rewriteRelativePaths(
                renderedContent,
                post.assetBasePath || this.resolvePostFolderPath(post) || ''
            );
            this.setupExplanationLinks(isEnglish ? 'english' : 'tamil', post);
        }

        this.setupTranslateButton(post);
        const explainCard = document.getElementById('explain-card');
        if (explainCard) {
            explainCard.hidden = true;
            explainCard.classList.remove('visible');
        }
        this.initGiscus();
        
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('post-page').classList.add('active');
    }

    renderRawMarkdownWithImages(content, basePath) {
        const raw = String(content ?? '');
        const imagePattern = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/gm;
        const normalizedBase = this.normalizeFolderPath(basePath);
        const escapedText = this.escapeHtml(raw);

        return escapedText.replace(imagePattern, (_, alt, src) => {
            const resolvedSrc = this.resolveRelativePath(normalizedBase, src);
            return `<img class="post-inline-image" src="${this.escapeHtml(resolvedSrc)}" alt="${this.escapeHtml(alt)}" loading="lazy" decoding="async" draggable="false">`;
        }).replace(/\n/g, '<br>');
    }

    navigateToPost(postId, updateUrl = true) {
        if (updateUrl) {
            this.updateBrowserPath(`post/${encodeURIComponent(postId)}`);
        }
        
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
    }

    initGiscus() {
        this.setupGiscusForPost();
    }

    setupGiscusForPost() {
        if (!this.currentPost) return;

        const giscusElement = document.querySelector('#giscus-comments');
        if (giscusElement) {
            giscusElement.innerHTML = '';
            
            const script = document.createElement('script');
            script.src = 'https://giscus.app/client.js';
            script.setAttribute('data-repo', 'arihara-sudhan/blog');
            script.setAttribute('data-repo-id', 'R_kgDOP23WIg');
            script.setAttribute('data-category', 'General');
            script.setAttribute('data-category-id', 'DIC_kwDOP23WIs4Cv48x');
            script.setAttribute('data-mapping', 'specific');
            script.setAttribute('data-term', `Blog Post: ${this.currentPost.title} (${this.currentPost.id})`);
            script.setAttribute('data-reactions-enabled', '1');
            script.setAttribute('data-emit-metadata', '0');
            script.setAttribute('data-input-position', 'top');
            script.setAttribute('data-theme', 'light');
            script.setAttribute('data-lang', 'en');
            script.setAttribute('data-loading', 'lazy');
            script.setAttribute('crossorigin', 'anonymous');
            script.async = true;
            
            giscusElement.appendChild(script);
        }

        const discussionLink = document.getElementById('github-discussion-link');
        if (discussionLink) {
            discussionLink.href = `https://github.com/arihara-sudhan/blog/discussions`;
            discussionLink.textContent = 'view the discussion on GitHub';
        }
    }


    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

let blogApp;
document.addEventListener('DOMContentLoaded', () => {
    blogApp = new BlogApp();
});

window.addEventListener('popstate', () => {
    if (blogApp) {
        blogApp.handleRouting();
    }
});


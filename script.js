class BlogApp {
    constructor() {
        this.posts = [];
        this.currentPost = null;
        this.comments = {};
        this.currentTopic = 'ellam';
        this.explanations = [];
        this.explanationIndex = new Map();
        this.activeExplanations = {};
        this.translationAvailability = new Map();
        
        this.init();
    }

    init() {
        this.loadData();
        this.setupEventListeners();
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

    isExternalUrl(value) {
        return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:|mailto:|javascript:)/i.test(String(value ?? ''));
    }

    resolveRelativePath(basePath, assetPath) {
        const cleanPath = String(assetPath ?? '').trim();
        if (!cleanPath || this.isExternalUrl(cleanPath) || cleanPath.startsWith('/')) {
            return cleanPath;
        }

        const normalizedBase = this.normalizeFolderPath(basePath);
        if (!normalizedBase || cleanPath.startsWith('static/')) {
            return cleanPath;
        }

        return `${normalizedBase}/${cleanPath.replace(/^\.?\//, '')}`;
    }

    resolvePostContentPath(post) {
        const folder = this.normalizeFolderPath(post.folder || post.source_folder || post.directory);
        if (folder) {
            return `${folder}/content.md`;
        }

        return `posts/${post.id}.md`;
    }

    resolvePostTranslationPath(post) {
        const folder = this.normalizeFolderPath(post.folder || post.source_folder || post.directory);
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

    resolvePostImage(post, imagePath) {
        const folder = this.normalizeFolderPath(post.folder || post.source_folder || post.directory);
        return this.resolveRelativePath(folder, imagePath);
    }

    resolveExplanationImage(post, imagePath) {
        const cleanPath = String(imagePath ?? '').trim();
        if (!cleanPath) {
            return '';
        }

        if (this.isExternalUrl(cleanPath) || cleanPath.startsWith('/')) {
            return cleanPath;
        }

        const folder = this.normalizeFolderPath(post?.folder || post?.source_folder || post?.directory);
        if (folder) {
            const relativePath = cleanPath.startsWith('images/') ? cleanPath : `images/${cleanPath}`;
            return this.resolveRelativePath(folder, relativePath);
        }

        if (cleanPath.startsWith('static/') || cleanPath.startsWith('images/')) {
            return cleanPath;
        }

        return `static/explanation_images/${cleanPath}`;
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
        const folder = this.normalizeFolderPath(post.folder || post.source_folder || post.directory);
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
            kavidhaigal: 'கவிதைகள்'
        };

        const availableTopics = Object.keys(topicLabels).filter(topic =>
            topic !== 'ellam' && this.posts.some(post => post.category === topic)
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
        const hash = window.location.hash.substring(1);
        
        if (hash.startsWith('post/')) {
            const postId = decodeURIComponent(hash.substring(5));
            this.showPost(postId);
        } else if (hash === 'about') {
            this.navigateToPage('about');
        } else {
            this.navigateToPage('home');
        }
    }

    navigateToPage(page) {
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
            window.location.hash = '';
        } else if (page === 'about') {
            document.getElementById('about-page').classList.add('active');
            window.location.hash = 'about';
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

        await this.annotatePostsWithTranslationStatus(this.posts);
        this.renderTopics();
        this.renderPosts();
    }

    filterByTopic(topic) {
        this.currentTopic = topic;
        this.renderTopics();
        this.renderPosts();
    }

    renderPosts() {
        const postsGrid = document.getElementById('posts-grid');
        
        if (this.posts.length === 0) {
            postsGrid.innerHTML = '<div class="empty-state">No posts available</div>';
            return;
        }

        // Sort posts by date in descending order (newest first)
        const sortedPosts = [...this.posts].sort((a, b) => new Date(b.date) - new Date(a.date));

        const filteredPosts = this.currentTopic === 'ellam' 
            ? sortedPosts 
            : sortedPosts.filter(post => post.category === this.currentTopic);

        if (filteredPosts.length === 0) {
            postsGrid.innerHTML = '<div class="empty-state">பதிவுகள் இல்லை</div>';
            return;
        }

        postsGrid.innerHTML = filteredPosts.map(post => `
            <div class="post-card" onclick="blogApp.showPost('${post.id}')">
                ${this.resolvePostImage(post, post.image) ? `<img src="${this.escapeHtml(this.resolvePostImage(post, post.image))}" alt="${this.escapeHtml(post.title)}" class="post-card-image">` : ''}
                <div class="post-card-content">
                    <h3>${post.title}</h3>
                    <div class="post-card-meta">
                        <span class="post-card-date">${new Date(post.date).toLocaleDateString()}</span>
                        <span class="post-card-language">${post.hasTranslation ? 'தமிழ் & English' : 'தமிழ்'}</span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    async loadPostFromSource(post) {
        const contentPath = this.resolvePostContentPath(post);
        let content = await this.fetchTextIfAvailable(contentPath);

        if (!content && !this.normalizeFolderPath(post.folder || post.source_folder || post.directory)) {
            content = await this.fetchTextIfAvailable(`https://raw.githubusercontent.com/arihara-sudhan/blog/main/posts/${post.id}.md`);
        }

        if (!content) {
            return null;
        }

        const parsedPost = this.parseMarkdownPost(content, post.id);
        const folder = this.normalizeFolderPath(post.folder || post.source_folder || post.directory);
        const postExplanations = await this.loadPostExplanations(post);
        const translatedContentPath = this.resolvePostTranslationPath(post);
        const resolvedTitle = parsedPost.title && parsedPost.title !== 'Untitled Post'
            ? parsedPost.title
            : post.title;

        return {
            ...post,
            ...parsedPost,
            title: resolvedTitle || parsedPost.title,
            folder,
            image: parsedPost.image || post.image || '',
            assetBasePath: folder,
            translated_content: translatedContentPath || post.translated_content,
            explanationIndex: postExplanations.index,
            explanations: postExplanations.entries
        };
    }

    async showPost(postId) {
        if (this.explanationsReady) {
            await this.explanationsReady;
        }

        let post = this.posts.find(p => p.id === postId);

        if (post && (!post.content || post.folder || post.source_folder || post.directory)) {
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
        this.navigateToPost(postId);
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
                    const parsed = this.parseMarkdownPost(raw, post.id);
                    post.translatedContent = parsed.content;

                    if (!post.title_english) {
                        post.title_english = parsed.title || post.title;
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
                    ? `<img class="explain-card-image" src="${this.escapeHtml(this.resolveExplanationImage(post, entry.image))}" alt="${this.escapeHtml(entry[language] || entry.title || '')}"/>`
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
        const lines = content.split('\n');
        let title = '';
        let date = new Date().toISOString();
        let image = '';
        let author = 'Admin';
        
        if (lines[0].startsWith('---')) {
            let i = 1;
            while (i < lines.length && !lines[i].startsWith('---')) {
                const line = lines[i];
                if (line.startsWith('title:')) {
                    title = line.substring(6).trim().replace(/['"]/g, '');
                } else if (line.startsWith('date:')) {
                    date = line.substring(5).trim();
                } else if (line.startsWith('image:')) {
                    image = line.substring(6).trim();
                } else if (line.startsWith('author:')) {
                    author = line.substring(7).trim();
                }
                i++;
            }
            content = lines.slice(i + 1).join('\n');
        }

        if (!title) {
            const titleMatch = content.match(/^#\s+(.+)$/m);
            if (titleMatch) {
                title = titleMatch[1];
                content = content.replace(/^#\s+.+$/m, '');
            }
        }

        const excerpt = this.generateExcerpt(content);

        return {
            id: postId,
            title: title || 'Untitled Post',
            content: content,
            excerpt: excerpt,
            date: date,
            image: image,
            author: author
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
        postTitleElement.textContent = isEnglish
            ? (post.title_english || post.title)
            : post.title;
        
        // Add hr after title if it doesn't exist
        const nextEl = postTitleElement.nextElementSibling;
        if (!nextEl || nextEl.tagName !== 'HR') {
            const hr = document.createElement('hr');
            postTitleElement.parentNode.insertBefore(hr, postTitleElement.nextSibling);
        }
        
        const contentToRender = isEnglish
            ? (post.translatedContent || post.content)
            : post.content;

        const annotatedContent = this.applyExplanations(contentToRender, isEnglish ? 'english' : 'tamil', post);
        const renderedContent = marked.parse(annotatedContent);
        document.getElementById('post-content').innerHTML = this.rewriteRelativePaths(
            renderedContent,
            post.assetBasePath || post.folder || post.source_folder || post.directory || ''
        );

        this.setupTranslateButton(post);
        this.setupExplanationLinks(isEnglish ? 'english' : 'tamil', post);
        this.initGiscus();
        
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('post-page').classList.add('active');
    }

    navigateToPost(postId) {
        window.location.hash = `post/${postId}`;
        
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

window.addEventListener('hashchange', () => {
    if (blogApp) {
        blogApp.handleRouting();
    }
});

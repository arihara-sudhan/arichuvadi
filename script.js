class BlogApp {
    constructor() {
        this.posts = [];
        this.currentPost = null;
        this.comments = {};
        this.currentTopic = 'all';
        this.explanations = {};
        this.activeExplanations = {};
        
        this.init();
    }

    init() {
        this.loadData();
        this.setupEventListeners();
        this.handleRouting();
        this.loadPosts();
        this.loadExplanations();
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

                if (Array.isArray(data)) {
                    this.explanations = data;
                } else if (data && typeof data === 'object') {
                    // Backward compatibility for the older keyed-object format.
                    this.explanations = Object.entries(data)
                        .filter(([, value]) => value && typeof value === 'object')
                        .map(([key, value]) => ({
                            words: key.split('|').map(word => word.trim()).filter(Boolean),
                            ...value
                        }));
                } else {
                    this.explanations = [];
                }
            } else {
                console.warn('Could not load explanations.json:', response.status);
                this.explanations = [];
            }
        } catch (error) {
            console.warn('Error loading explanations.json:', error);
            this.explanations = [];
        }
    }

    setupEventListeners() {
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.dataset.page;
                this.navigateToPage(page);
            });
        });

        document.querySelectorAll('.topic-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const topic = btn.dataset.topic;
                this.filterByTopic(topic);
                
                document.querySelectorAll('.topic-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
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

        this.renderPosts();
    }

    filterByTopic(topic) {
        this.currentTopic = topic;
        this.renderPosts();
    }

    renderPosts() {
        const postsGrid = document.getElementById('posts-grid');
        
        if (this.posts.length === 0) {
            postsGrid.innerHTML = '<div class="loading">No posts available</div>';
            return;
        }

        // Sort posts by date in descending order (newest first)
        const sortedPosts = [...this.posts].sort((a, b) => new Date(b.date) - new Date(a.date));

        const filteredPosts = this.currentTopic === 'all' 
            ? sortedPosts 
            : sortedPosts.filter(post => post.category === this.currentTopic);

        if (filteredPosts.length === 0) {
            postsGrid.innerHTML = '<div class="loading">No posts in this category yet</div>';
            return;
        }

        postsGrid.innerHTML = filteredPosts.map(post => `
            <div class="post-card" onclick="blogApp.showPost('${post.id}')">
                ${post.image ? `<img src="${post.image}" alt="${post.title}" class="post-card-image">` : ''}
                <div class="post-card-content">
                    <h3>${post.title}</h3>
                    <p>${post.excerpt}</p>
                    <div class="post-card-meta">
                        <span>${new Date(post.date).toLocaleDateString()}</span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    async showPost(postId) {
        let post = this.posts.find(p => p.id === postId);
        
        if (post && !post.content) {
            try {
                // Try local file first, fallback to GitHub
                let response = await fetch(`posts/${postId}.md`);
                if (!response.ok) {
                    response = await fetch(`https://raw.githubusercontent.com/arihara-sudhan/blog/main/posts/${postId}.md`);
                }
                if (response.ok) {
                    const content = await response.text();
                    const parsedPost = this.parseMarkdownPost(content, postId);
        
                    post.content = parsedPost.content;
                    post.date = parsedPost.date || post.date;
                    post.author = parsedPost.author || post.author;
                    post.image = parsedPost.image || post.image;
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

                if (!post.translated_content) {
                    alert('Translation source not available for this post yet.');
                    return;
                }

                try {
                    const response = await fetch(post.translated_content);
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
        const entries = Array.isArray(this.explanations) ? this.explanations : [];
        this.activeExplanations = {};
        let explanationIndex = 0;

        const normalizedEntries = entries.filter(entry =>
            entry &&
            typeof entry === 'object' &&
            Array.isArray(entry.words)
        );

        return content.replace(/<qn>([\s\S]*?)<\/qn>/gu, (_, rawTerm) => {
            const target = rawTerm.trim();
            if (!target) return rawTerm;

            const entry = normalizedEntries.find(item =>
                item.words.some(word =>
                    typeof word === 'string' &&
                    word.trim().localeCompare(target, undefined, { sensitivity: 'accent' }) === 0
                )
            );

            if (!entry) {
                return target;
            }

            const explanationId = `expl-${explanationIndex++}`;
            this.activeExplanations[explanationId] = {
                ...entry,
                _id: explanationId,
                _target: target
            };

            return `<span class="expl-term" data-expl-id="${explanationId}">${target}<sup>?</sup></span>`;
        });
    }

    setupExplanationLinks(language) {
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

                const imageHtml = entry.image ? `<img class="explain-card-image" src="static/explanation_images/${entry.image}" alt="${entry[language]||''}"/>` : '';
                const text = entry[language] || 'No explanation found';

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
        document.getElementById('post-content').innerHTML = marked.parse(annotatedContent);

        this.setupTranslateButton(post);
        this.setupExplanationLinks(isEnglish ? 'english' : 'tamil');
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

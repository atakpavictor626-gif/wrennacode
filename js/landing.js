/**
 * WRENNA — Landing Page Interactions
 * Lightweight, dependency-free, progressive enhancement.
 */

// ============================================================
// SCROLL REVEAL (Intersection Observer)
// ============================================================
class ScrollReveal {
    constructor() {
        this.reveals = document.querySelectorAll('.reveal');
        this.observer = null;
        this.init();
    }
    
    init() {
        // Skip if user prefers reduced motion
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            this.reveals.forEach(el => el.classList.add('revealed'));
            return;
        }
        
        // Fallback for older browsers
        if (!('IntersectionObserver' in window)) {
            this.reveals.forEach(el => el.classList.add('revealed'));
            return;
        }
        
        this.observer = new IntersectionObserver(
            (entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('revealed');
                        this.observer.unobserve(entry.target);
                    }
                });
            },
            {
                threshold: 0.15,
                rootMargin: '0px 0px -40px 0px'
            }
        );
        
        this.reveals.forEach(el => this.observer.observe(el));
    }
    
    destroy() {
        if (this.observer) {
            this.observer.disconnect();
        }
    }
}

// ============================================================
// NAVBAR SCROLL STATE
// ============================================================
class NavScrollState {
    constructor() {
        this.nav = document.querySelector('.nav');
        this.lastScrollY = 0;
        this.scrollThreshold = 32;
        this.init();
    }
    
    init() {
        window.addEventListener('scroll', () => {
            this.handleScroll();
        }, { passive: true });
    }
    
    handleScroll() {
        const scrollY = window.scrollY;
        
        if (scrollY > this.scrollThreshold) {
            this.nav.style.boxShadow = '0 4px 24px rgba(0, 0, 0, 0.4)';
            this.nav.style.background = 'rgba(22, 18, 14, 0.95)';
        } else {
            this.nav.style.boxShadow = '';
            this.nav.style.background = 'rgba(22, 18, 14, 0.9)';
        }
        
        this.lastScrollY = scrollY;
    }
}

// ============================================================
// SMOOTH ANCHOR SCROLL (with offset for fixed nav)
// ============================================================
class SmoothScroll {
    constructor() {
        this.links = document.querySelectorAll('a[href^="#"]');
        this.init();
    }
    
    init() {
        this.links.forEach(link => {
            link.addEventListener('click', (e) => {
                const href = link.getAttribute('href');
                if (href === '#' || href === '') return;
                
                const target = document.querySelector(href);
                if (!target) return;
                
                e.preventDefault();
                this.scrollTo(target);
            });
        });
    }
    
    scrollTo(target) {
        const navHeight = 64;
        const targetPosition = target.getBoundingClientRect().top + window.scrollY - navHeight;
        
        window.scrollTo({
            top: targetPosition,
            behavior: 'smooth'
        });
    }
}

// ============================================================
// WREN FLIGHT RANDOMIZER
// ============================================================
class WrenVariation {
    constructor() {
        this.wren = document.querySelector('.wren');
        this.init();
    }
    
    init() {
        if (!this.wren) return;
        
        // Randomize vertical position and timing each load
        const randomTop = 15 + Math.random() * 20;
        const randomDuration = 12 + Math.random() * 6;
        const randomDelay = Math.random() * 4;
        
        this.wren.style.top = `${randomTop}%`;
        this.wren.style.animationDuration = `${randomDuration}s, 1.8s`;
        this.wren.style.animationDelay = `${randomDelay}s, 0s`;
    }
}

// ============================================================
// HERO PARALLAX (subtle, GPU-accelerated, desktop only)
// ============================================================
class HeroParallax {
    constructor() {
        this.heroContent = document.querySelector('.hero-content');
        this.scrollHandler = null;
        this.init();
    }
    
    init() {
        // Skip on mobile and reduced motion
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        if (window.innerWidth < 768) return;
        if (!this.heroContent) return;
        
        this.scrollHandler = this.throttle(() => {
            const scrollY = window.scrollY;
            if (scrollY < window.innerHeight) {
                const offset = scrollY * 0.15;
                this.heroContent.style.transform = `translateY(${offset}px)`;
                this.heroContent.style.opacity = 1 - (scrollY / window.innerHeight) * 0.8;
            }
        }, 16);
        
        window.addEventListener('scroll', this.scrollHandler, { passive: true });
    }
    
    throttle(func, limit) {
        let inThrottle = false;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
}

// ============================================================
// MAGNETIC BUTTONS (subtle hover attraction, pointer devices only)
// ============================================================
class MagneticButtons {
    constructor() {
        this.buttons = document.querySelectorAll('.btn-primary');
        this.init();
    }
    
    init() {
        // Only on devices with hover capability
        if (!window.matchMedia('(hover: hover)').matches) return;
        
        this.buttons.forEach(btn => {
            btn.addEventListener('mousemove', (e) => {
                const rect = btn.getBoundingClientRect();
                const x = e.clientX - rect.left - rect.width / 2;
                const y = e.clientY - rect.top - rect.height / 2;
                
                // Subtle magnetic pull (max ~4px)
                const moveX = x * 0.08;
                const moveY = y * 0.12;
                
                btn.style.transform = `translate(${moveX}px, ${moveY}px)`;
            });
            
            btn.addEventListener('mouseleave', () => {
                btn.style.transform = '';
            });
        });
    }
}

// ============================================================
// PAGE LOAD ENTRANCE STAGGER
// ============================================================
class PageLoadAnimation {
    constructor() {
        this.heroContent = document.querySelector('.hero-content');
        this.init();
    }
    
    init() {
        if (!this.heroContent) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        
        const elements = this.heroContent.children;
        Array.from(elements).forEach((el, index) => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(20px)';
            el.style.transition = `opacity 0.6s var(--ease-glide) ${index * 0.1}s, transform 0.6s var(--ease-spring) ${index * 0.1}s`;
        });
        
        // Trigger after two frames (ensures initial styles applied)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                Array.from(elements).forEach(el => {
                    el.style.opacity = '1';
                    el.style.transform = 'translateY(0)';
                });
            });
        });
    }
}

// ============================================================
// INITIALIZE
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    new ScrollReveal();
    new NavScrollState();
    new SmoothScroll();
    new WrenVariation();
    new HeroParallax();
    new MagneticButtons();
    new PageLoadAnimation();
});

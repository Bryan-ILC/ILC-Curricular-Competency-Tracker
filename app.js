// BC Curriculum Competency Tracker
// Privacy-first application - all data stored locally

class CompetencyTracker {
    constructor() {
        this.db = null;
        this.currentStudentId = null;
        this.currentCourseId = null;
        this.googleAccessToken = null;
        this.googleDriveFileId = null;
        // View preferences
        this.studentsView = localStorage.getItem('studentsView') || 'icons';
        this.coursesView = localStorage.getItem('coursesView') || 'icons';
        this.studentsSort = localStorage.getItem('studentsSort') || 'name';
        this.coursesSort = localStorage.getItem('coursesSort') || 'name';
        // Track original form states for unsaved changes detection
        this.originalFormStates = new Map();
        // Track if weekends have been initialized
        this._weekendsInitialized = false;
        // Track attendance unsaved changes
        this.attendanceOriginalState = new Map(); // Map of studentId -> status for current date
        this.attendanceHasUnsavedChanges = false;
        // Auto-sync timer
        this.autoSyncInterval = null;
        // Google Drive API Configuration
        // Google OAuth Client ID from: https://console.cloud.google.com/apis/credentials
        this.googleClientId = '300204383142-eh36815ii1kvng5ranq7vagj78a4050d.apps.googleusercontent.com';
        this.googleApiKey = ''; // Optional, for additional security
        this.init();
    }

    getCourseOrderIndex(courseName = '') {
        const name = (courseName || '').toLowerCase();

        // 0: Term Comment
        if (name.includes('term comment')) return 0;

        // 1: English / Literary Studies
        if (name.includes('english') || name.includes('literary studies')) return 1;

        // 2: Math and Accounting
        if (
            name.includes('math') ||
            name.includes('pre-calculus') ||
            name.includes('foundations') ||
            name.includes('calculus') ||
            name.includes('accounting')
        ) return 2;

        // 3: Science
        if (
            name.includes('science') ||
            name.includes('biology') ||
            name.includes('chemistry') ||
            name.includes('physics') ||
            name.includes('anatomy') ||
            name.includes('physiology')
        ) return 3;

        // 4: Social Studies (YFN, Law, Social Justice)
        if (
            name.includes('yukon first nation') ||
            name.includes('first nation studies') ||
            name.includes('law') ||
            name.includes('social justice') ||
            name.includes('social studies')
        ) return 4;

        // 5: Career Life Education
        if (name.includes('career life education')) return 5;

        // 6: Career Life Connections
        if (name.includes('career life connection')) return 6;

        // 7: Art
        if (name.includes('art')) return 7;

        // 8: Food Studies
        if (name.includes('food studies')) return 8;

        // 9: Child Development
        if (name.includes('child development')) return 9;

        // 10: Active Living
        if (name.includes('active living')) return 10;

        // 11: Physical and Health Education
        if (name.includes('physical and health education') || name.includes('phe')) return 11;

        // 12: Fitness and Conditioning
        if (name.includes('fitness and conditioning') || name.includes('fitness')) return 12;

        // 13: Work Experience
        if (name.includes('work experience')) return 13;

        // Default bucket at the end
        return 99;
    }

    async init() {
        await this.initDB();
        this.setupEventListeners();
        this.loadData();
        this.loadStockComments();
    }

    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('CompetencyTrackerDB', 6);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Students store
                if (!db.objectStoreNames.contains('students')) {
                    const studentStore = db.createObjectStore('students', { keyPath: 'id', autoIncrement: true });
                    studentStore.createIndex('name', 'name', { unique: false });
                }

                // Courses store
                if (!db.objectStoreNames.contains('courses')) {
                    const courseStore = db.createObjectStore('courses', { keyPath: 'id', autoIncrement: true });
                    courseStore.createIndex('name', 'name', { unique: false });
                }

                // Records store (competency demonstrations)
                if (!db.objectStoreNames.contains('records')) {
                    const recordStore = db.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
                    recordStore.createIndex('studentId', 'studentId', { unique: false });
                    recordStore.createIndex('courseId', 'courseId', { unique: false });
                    recordStore.createIndex('date', 'date', { unique: false });
                }

                // Stock comments store
                if (!db.objectStoreNames.contains('stockComments')) {
                    db.createObjectStore('stockComments', { keyPath: 'id', autoIncrement: true });
                }

                // Attendance store
                if (!db.objectStoreNames.contains('attendance')) {
                    const attendanceStore = db.createObjectStore('attendance', { keyPath: 'id', autoIncrement: true });
                    attendanceStore.createIndex('date', 'date', { unique: false });
                    attendanceStore.createIndex('studentId', 'studentId', { unique: false });
                }

                // Non-instructional days store
                if (!db.objectStoreNames.contains('nonInstructionalDays')) {
                    db.createObjectStore('nonInstructionalDays', { keyPath: 'date', autoIncrement: false });
                }

                // Attendance color indicators store (for manual color selection)
                if (!db.objectStoreNames.contains('attendanceColorIndicators')) {
                    const colorStore = db.createObjectStore('attendanceColorIndicators', { keyPath: 'id', autoIncrement: true });
                    colorStore.createIndex('studentId', 'studentId', { unique: false });
                }

                // Attendance notes store (narrative notes that follow students across dates)
                if (!db.objectStoreNames.contains('attendanceNotes')) {
                    const notesStore = db.createObjectStore('attendanceNotes', { keyPath: 'id', autoIncrement: true });
                    notesStore.createIndex('studentId', 'studentId', { unique: false });
                }

                // Teacher tracking store (which teacher is tracking which student)
                if (!db.objectStoreNames.contains('teacherTracking')) {
                    const teacherStore = db.createObjectStore('teacherTracking', { keyPath: 'id', autoIncrement: true });
                    teacherStore.createIndex('studentId', 'studentId', { unique: false });
                }
            };
        });
    }

    setupEventListeners() {
        // Tab navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = e.target.dataset.tab;
                this.switchTab(tab);
            });
        });

        // Student management
        document.getElementById('add-student-btn').addEventListener('click', () => this.showStudentModal());
        document.getElementById('student-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveStudent();
        });
        document.getElementById('cancel-student-btn').addEventListener('click', () => this.closeModal('student-modal'));
        document.getElementById('import-students-btn').addEventListener('click', () => {
            document.getElementById('import-students-file').click();
        });
        document.getElementById('import-students-file').addEventListener('change', (e) => this.importStudents(e));
        
        // Student view and sort controls
        document.getElementById('students-view-icons').addEventListener('click', () => {
            this.studentsView = 'icons';
            localStorage.setItem('studentsView', 'icons');
            this.updateViewButtons('students');
            this.loadStudents();
        });
        document.getElementById('students-view-list').addEventListener('click', () => {
            this.studentsView = 'list';
            localStorage.setItem('studentsView', 'list');
            this.updateViewButtons('students');
            this.loadStudents();
        });
        document.getElementById('students-sort').addEventListener('change', (e) => {
            this.studentsSort = e.target.value;
            localStorage.setItem('studentsSort', e.target.value);
            this.loadStudents();
        });

        // Course management
        document.getElementById('add-course-btn').addEventListener('click', () => this.showCourseModal());
        document.getElementById('course-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveCourse();
        });
        document.getElementById('cancel-course-btn').addEventListener('click', () => this.closeModal('course-modal'));
        document.getElementById('add-competency-btn').addEventListener('click', () => this.addCompetencyField());
        
        // Course view and sort controls
        document.getElementById('courses-view-icons').addEventListener('click', () => {
            this.coursesView = 'icons';
            localStorage.setItem('coursesView', 'icons');
            this.updateViewButtons('courses');
            this.loadCourses();
        });
        document.getElementById('courses-view-list').addEventListener('click', () => {
            this.coursesView = 'list';
            localStorage.setItem('coursesView', 'list');
            this.updateViewButtons('courses');
            this.loadCourses();
        });
        document.getElementById('courses-sort').addEventListener('change', (e) => {
            this.coursesSort = e.target.value;
            localStorage.setItem('coursesSort', e.target.value);
            this.loadCourses();
        });

        // Record competencies
        document.getElementById('record-student').addEventListener('change', async (e) => {
            const newStudentId = parseInt(e.target.value);
            if (this.currentStudentId && this.currentStudentId !== newStudentId) {
                // Check for unsaved changes before switching
                const hasUnsaved = await this.checkForUnsavedChanges();
                if (hasUnsaved) {
                    const result = await this.promptSaveUnsavedChanges();
                    if (result === 'cancel') {
                        // Revert dropdown to previous student
                        e.target.value = this.currentStudentId;
                        return;
                    } else if (result === 'save') {
                        // Save all unsaved changes
                        await this.saveAllUnsavedChanges();
                    }
                    // If result is 'discard', continue with the switch
                }
            }
            this.currentStudentId = newStudentId;
            await this.loadStudentCourses();
        });

        // Reports
        document.getElementById('generate-report-btn').addEventListener('click', () => this.generateReport());
        document.getElementById('export-csv-btn').addEventListener('click', () => this.exportToCSV());
        document.getElementById('generate-aspen-btn').addEventListener('click', () => this.generateAspenFormat());
        const reportCardBtn = document.getElementById('generate-report-card-btn');
        const printReportCardBtn = document.getElementById('print-report-card-btn');
        if (reportCardBtn) reportCardBtn.addEventListener('click', () => this.generateReportCard());
        if (printReportCardBtn) printReportCardBtn.addEventListener('click', () => this.printReportCard());
        document.getElementById('generate-attendance-report-btn').addEventListener('click', () => this.generateAttendanceReport());

        // Settings
        document.getElementById('export-data-btn').addEventListener('click', () => this.exportAllData());
        document.getElementById('import-data-btn').addEventListener('click', () => {
            document.getElementById('import-file').click();
        });
        document.getElementById('import-file').addEventListener('change', (e) => this.importData(e));
        document.getElementById('clear-data-btn').addEventListener('click', () => {
            if (!this.verifyPassword()) {
                alert('Incorrect password. Action cancelled.');
                return;
            }
            
            if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
                this.clearAllData();
            }
        });
        document.getElementById('add-stock-comment-btn').addEventListener('click', () => this.addStockComment());
        
        // Team Collaboration
        document.getElementById('export-enrollments-btn').addEventListener('click', () => this.exportEnrollments());
        document.getElementById('import-enrollments-btn').addEventListener('click', () => {
            document.getElementById('import-enrollments-file').click();
        });
        document.getElementById('import-enrollments-file').addEventListener('change', (e) => this.importEnrollments(e));
        
        // Google Drive Sync
        const connectBtn = document.getElementById('connect-drive-btn');
        const syncBtn = document.getElementById('sync-drive-btn');
        const disconnectBtn = document.getElementById('disconnect-drive-btn');
        
        if (connectBtn) {
            connectBtn.addEventListener('click', () => {
                console.log('Connect button clicked');
                this.connectGoogleDrive();
            });
        }
        if (syncBtn) {
            syncBtn.addEventListener('click', () => this.syncWithGoogleDrive());
        }
        if (disconnectBtn) {
            disconnectBtn.addEventListener('click', () => this.disconnectGoogleDrive());
        }
        
        // Check if already connected on load
        this.checkGoogleDriveConnection();
        
        // Start automatic sync if connected
        this.startAutoSync();
        
        // Initialize view buttons
        this.updateViewButtons('students');
        this.updateViewButtons('courses');
        document.getElementById('students-sort').value = this.studentsSort;
        document.getElementById('courses-sort').value = this.coursesSort;

        // Modal close buttons
        document.querySelectorAll('.close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    this.closeModal(modal.id);
                }
            });
        });

        // Close modal on outside click (backdrop click) - improved
        document.addEventListener('click', (e) => {
            // Check if click is on modal backdrop (not on modal-content)
            if (e.target.classList.contains('modal') && !e.target.closest('.modal-content')) {
                const modalId = e.target.id || e.target.closest('.modal')?.id;
                if (modalId) {
                    this.closeModal(modalId);
                }
            }
        });

        // Attendance tab event listeners
        const attendanceDateInput = document.getElementById('attendance-date');
        if (attendanceDateInput) {
            attendanceDateInput.addEventListener('change', async () => {
                await this.checkUnsavedAttendanceChanges(() => this.loadAttendanceForDate());
            });
            // Set default date to today
            attendanceDateInput.value = new Date().toISOString().split('T')[0];
        }

        // Date navigation buttons
        document.getElementById('prev-day-btn')?.addEventListener('click', async () => {
            await this.checkUnsavedAttendanceChanges(() => this.navigateDate(-1));
        });
        document.getElementById('next-day-btn')?.addEventListener('click', async () => {
            await this.checkUnsavedAttendanceChanges(() => this.navigateDate(1));
        });

        document.getElementById('save-attendance-btn')?.addEventListener('click', () => this.saveAttendance());
        document.getElementById('mark-all-present-btn')?.addEventListener('click', () => this.markAllAttendance(true));
        document.getElementById('mark-all-absent-btn')?.addEventListener('click', () => this.markAllAttendance(false));
        document.getElementById('non-instructional-day')?.addEventListener('change', (e) => this.toggleNonInstructionalDay(e.target.checked));
    }

    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(`${tabName}-tab`).classList.add('active');

        // Load data when switching to certain tabs
        if (tabName === 'students') {
            this.loadStudents();
        } else if (tabName === 'courses') {
            this.loadCourses();
        } else if (tabName === 'reports') {
            this.populateReportDropdowns();
            // Initialize default dates for attendance report
            const endDateInput = document.getElementById('attendance-report-end-date');
            const startDateInput = document.getElementById('attendance-report-start-date');
            if (endDateInput && !endDateInput.value) {
                const today = new Date();
                endDateInput.value = today.toISOString().split('T')[0];
            }
            if (startDateInput && !startDateInput.value) {
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                startDateInput.value = thirtyDaysAgo.toISOString().split('T')[0];
            }
        } else if (tabName === 'attendance') {
            // Initialize weekends and holidays on first load
            if (!this._weekendsInitialized) {
                this.ensureWeekendsAreNonInstructional().then(() => {
                    this.ensureHolidaysAreNonInstructional().then(() => {
                        this._weekendsInitialized = true;
                        this.loadAttendanceForDate();
                    });
                });
            } else {
                this.loadAttendanceForDate();
            }
        } else if (tabName === 'record') {
            this.populateDropdowns();
            // If a course is already selected, update student dropdown
            const courseId = document.getElementById('record-course').value;
            if (courseId) {
                this.updateStudentDropdownForCourse();
            }
        } else if (tabName === 'reports') {
            this.populateReportDropdowns();
        } else if (tabName === 'settings') {
            this.loadStockComments();
        }
    }

    updateViewButtons(type) {
        const iconsBtn = document.getElementById(`${type}-view-icons`);
        const listBtn = document.getElementById(`${type}-view-list`);
        const container = document.getElementById(`${type}-list`);
        
        if (this[`${type}View`] === 'list') {
            container.classList.add('list-view');
            if (iconsBtn) iconsBtn.classList.remove('active');
            if (listBtn) listBtn.classList.add('active');
        } else {
            container.classList.remove('list-view');
            if (iconsBtn) iconsBtn.classList.add('active');
            if (listBtn) listBtn.classList.remove('active');
        }
    }

    // Student Management
    async loadStudents() {
        const students = await this.getAll('students');
        const courses = await this.getAll('courses');
        const container = document.getElementById('students-list');
        container.innerHTML = '';

        if (students.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--secondary-color); padding: 40px;">No students added yet. Click "Add Student" to get started.</p>';
            return;
        }

        // Sort students
        const sortedStudents = [...students].sort((a, b) => {
            if (this.studentsSort === 'grade') {
                const gradeA = parseInt(a.grade) || 0;
                const gradeB = parseInt(b.grade) || 0;
                if (gradeA !== gradeB) return gradeA - gradeB;
            }
            // Default to name sort or as tiebreaker
            return (a.name || '').localeCompare(b.name || '');
        });

        // Update view class
        this.updateViewButtons('students');

        sortedStudents.forEach(student => {
            const enrolledCourses = (student.courseIds || []).map(courseId => {
                const course = courses.find(c => c.id === courseId);
                return course ? course.name : null;
            }).filter(Boolean);

            const card = document.createElement('div');
            card.className = 'student-card';
            
            if (this.studentsView === 'list') {
                // List view - compact horizontal layout
                card.innerHTML = `
                    <div style="flex: 1; min-width: 200px;">
                        <h3 style="margin: 0 0 5px 0;">${this.escapeHtml(student.name)}</h3>
                        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 5px;">
                            ${student.grade ? `<span style="background: var(--primary-color); color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.85rem;">Grade ${student.grade}</span>` : ''}
                            ${student.gradPlan ? `<span style="background: linear-gradient(135deg, var(--pride-green) 0%, var(--pride-blue) 100%); color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.85rem;">${this.escapeHtml(student.gradPlan)}</span>` : ''}
                            ${student.crossEnrolment ? `<span style="background: linear-gradient(135deg, var(--pride-orange) 0%, var(--pride-yellow) 100%); color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.85rem;">${this.escapeHtml(student.crossEnrolment)}</span>` : ''}
                            ${student.iep ? `<span class="badge badge-${student.iep.toLowerCase()}">${student.iep === 'I' ? 'IEP' : 'SSP'}</span>` : ''}
                        </div>
                        <div style="font-size: 0.9rem; color: var(--secondary-color);">
                            ${enrolledCourses.length > 0 ? `${enrolledCourses.length} course(s)` : 'No courses'}
                        </div>
                    </div>
                    <div style="display: flex; gap: 5px; flex-wrap: wrap; align-items: center;">
                        <button class="btn btn-secondary" onclick="tracker.editStudent(${student.id})">Edit</button>
                        <button class="btn btn-primary" onclick="tracker.manageStudentCourses(${student.id})" style="font-size: 0.9rem; padding: 8px 12px;">Manage Courses</button>
                        <button class="btn btn-danger" onclick="tracker.deleteStudent(${student.id})">Delete</button>
                    </div>
                `;
            } else {
                // Icon/card view - original layout
                card.innerHTML = `
                    <h3>${this.escapeHtml(student.name)}</h3>
                    <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap;">
                        ${student.grade ? `<span style="background: var(--primary-color); color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.85rem;">Grade ${student.grade}</span>` : ''}
                        ${student.gradPlan ? `<span style="background: linear-gradient(135deg, var(--pride-green) 0%, var(--pride-blue) 100%); color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.85rem;">${this.escapeHtml(student.gradPlan)}</span>` : ''}
                        ${student.crossEnrolment ? `<span style="background: linear-gradient(135deg, var(--pride-orange) 0%, var(--pride-yellow) 100%); color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.85rem;">${this.escapeHtml(student.crossEnrolment)}</span>` : ''}
                        ${student.iep ? `<span class="badge badge-${student.iep.toLowerCase()}">${student.iep === 'I' ? 'IEP' : 'SSP'}</span>` : ''}
                    </div>
                    <div style="margin-top: 10px; margin-bottom: 10px;">
                        <strong>Courses:</strong>
                        ${enrolledCourses.length > 0 
                            ? `<div style="margin-top: 5px;">${enrolledCourses.map(c => `<span style="display: inline-block; background: var(--bg-color); padding: 4px 8px; border-radius: 4px; margin: 2px; font-size: 0.85rem;">${this.escapeHtml(c)}</span>`).join('')}</div>`
                            : '<span style="color: var(--secondary-color); font-size: 0.9rem;">None</span>'
                        }
                    </div>
                    <div style="margin-top: 15px; display: flex; gap: 5px; flex-wrap: wrap;">
                        <button class="btn btn-secondary" onclick="tracker.editStudent(${student.id})">Edit</button>
                        <button class="btn btn-primary" onclick="tracker.manageStudentCourses(${student.id})" style="font-size: 0.9rem; padding: 8px 12px;">Manage Courses</button>
                        <button class="btn btn-danger" onclick="tracker.deleteStudent(${student.id})">Delete</button>
                    </div>
                `;
            }
            container.appendChild(card);
        });
    }

    showStudentModal(studentId = null) {
        this.currentStudentId = studentId;
        const modal = document.getElementById('student-modal');
        const form = document.getElementById('student-form');
        const title = document.getElementById('student-modal-title');

        if (studentId) {
            title.textContent = 'Edit Student';
            this.get('students', studentId).then(student => {
                document.getElementById('student-name').value = student.name;
                document.getElementById('student-grade').value = student.grade || '';
                document.getElementById('student-grad-plan').value = student.gradPlan || '';
                document.getElementById('student-cross-enrolment').value = student.crossEnrolment || '';
                document.getElementById('student-iep').value = student.iep || '';
            });
        } else {
            title.textContent = 'Add Student';
            form.reset();
        }

        modal.style.display = 'block';
    }

    async saveStudent() {
        const name = document.getElementById('student-name').value.trim();
        const grade = document.getElementById('student-grade').value;
        const gradPlan = document.getElementById('student-grad-plan').value;
        const crossEnrolment = document.getElementById('student-cross-enrolment').value;
        const iep = document.getElementById('student-iep').value;

        if (!name) {
            alert('Please enter a student name');
            return;
        }

        const existingStudent = this.currentStudentId ? await this.get('students', this.currentStudentId) : null;
        const student = {
            name,
            grade: grade || null,
            gradPlan: gradPlan || null,
            crossEnrolment: crossEnrolment || null,
            iep: iep || null,
            courseIds: existingStudent?.courseIds || [],
            createdAt: existingStudent?.createdAt || new Date().toISOString()
        };

        if (this.currentStudentId) {
            student.id = this.currentStudentId;
            await this.update('students', student);
        } else {
            await this.add('students', student);
        }

        this.closeModal('student-modal');
        this.loadStudents();
        this.populateDropdowns();
    }

    async editStudent(id) {
        this.showStudentModal(id);
    }

    verifyPassword() {
        const password = prompt('Please enter the password to confirm this action:');
        return password === 'Sullivan';
    }

    async deleteStudent(id) {
        if (!this.verifyPassword()) {
            alert('Incorrect password. Action cancelled.');
            return;
        }
        
        if (confirm('Are you sure you want to delete this student? All associated records will also be deleted.')) {
            await this.delete('students', id);
            // Also delete associated records
            const records = await this.getAll('records');
            const studentRecords = records.filter(r => r.studentId === id);
            for (const record of studentRecords) {
                await this.delete('records', record.id);
            }
            // Remove student from all courses
            const courses = await this.getAll('courses');
            for (const course of courses) {
                if (course.studentIds && course.studentIds.includes(id)) {
                    course.studentIds = course.studentIds.filter(sid => sid !== id);
                    await this.update('courses', course);
                }
            }
            this.loadStudents();
            this.loadCourses();
            this.populateDropdowns();
        }
    }

    async importStudents(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const text = e.target.result;
                const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
                
                if (lines.length === 0) {
                    alert('File is empty or contains no valid student names.');
                    event.target.value = '';
                    return;
                }

                // Check if first line looks like a header (CSV format)
                let startIndex = 0;
                const firstLine = lines[0].toLowerCase();
                if (firstLine.includes('name') || firstLine.includes('last') || firstLine.includes('first') || firstLine.includes('grade') || lines[0].includes(',')) {
                    startIndex = 1; // Skip header
                }

                const studentsToImport = [];
                for (let i = startIndex; i < lines.length; i++) {
                    const line = lines[i];
                    if (!line || line.length === 0) continue;
                    
                    // Parse CSV line: "Last, First, Grade" or "Last, First"
                    // Handle quoted values properly
                    const parts = [];
                    let currentPart = '';
                    let inQuotes = false;
                    
                    for (let j = 0; j < line.length; j++) {
                        const char = line[j];
                        if (char === '"') {
                            inQuotes = !inQuotes;
                        } else if (char === ',' && !inQuotes) {
                            parts.push(currentPart.trim());
                            currentPart = '';
                        } else {
                            currentPart += char;
                        }
                    }
                    // Add the last part
                    if (currentPart.length > 0) {
                        parts.push(currentPart.trim());
                    }
                    
                    // Remove empty parts and strip quotes from each part
                    const cleanedParts = parts
                        .map(p => {
                            // Remove surrounding quotes (both single and double)
                            let cleaned = p.trim();
                            // Remove quotes from start and end
                            cleaned = cleaned.replace(/^["']+|["']+$/g, '');
                            // Remove any remaining quotes within (shouldn't happen, but just in case)
                            cleaned = cleaned.replace(/["']/g, '');
                            return cleaned.trim();
                        })
                        .filter(p => p.length > 0);
                    
                    if (cleanedParts.length === 0) continue;
                    
                    let firstName = '';
                    let lastName = '';
                    let grade = null;
                    
                    if (cleanedParts.length >= 2) {
                        // CSV format: "Last, First" or "Last, First, Grade"
                        // Column 0 = Last Name, Column 1 = First Name
                        // We need to reorder to "First Last"
                        const last = cleanedParts[0].trim();
                        const first = cleanedParts[1].trim();
                        
                        // Assign: CSV has Last,First so we swap to First Last
                        lastName = last;
                        firstName = first;
                        
                        // Check if there's a grade in the third column
                        if (cleanedParts.length >= 3) {
                            const gradeValue = cleanedParts[2].trim();
                            // Extract numeric grade (e.g., "10", "11", "12" or "Grade 10" -> "10")
                            const gradeMatch = gradeValue.match(/\d+/);
                            if (gradeMatch) {
                                grade = gradeMatch[0];
                            }
                        }
                    } else {
                        // Single value - might be "First Last" format
                        const nameParts = cleanedParts[0].split(/\s+/).filter(p => p.length > 0);
                        if (nameParts.length >= 2) {
                            firstName = nameParts[0];
                            lastName = nameParts.slice(1).join(' ');
                        } else {
                            // Single name, use as is
                            firstName = cleanedParts[0];
                        }
                    }
                    
                    // Final cleanup - remove any remaining quotes or extra spaces
                    firstName = firstName.replace(/["']/g, '').trim();
                    lastName = lastName.replace(/["']/g, '').trim();
                    
                    // Reorder to "First Last" format (from "Last, First" CSV format)
                    const fullName = firstName && lastName 
                        ? `${firstName} ${lastName}`.trim()
                        : firstName || lastName;
                    
                    if (fullName && fullName.length > 0) {
                        studentsToImport.push({
                            name: fullName,
                            grade: grade
                        });
                    }
                }

                if (studentsToImport.length === 0) {
                    alert('No valid student names found in file.');
                    event.target.value = '';
                    return;
                }

                // Show confirmation with preview
                const preview = studentsToImport.slice(0, 10).map(s => {
                    const gradeText = s.grade ? ` (Grade ${s.grade})` : '';
                    return `${s.name}${gradeText}`;
                }).join(', ');
                const moreText = studentsToImport.length > 10 ? ` and ${studentsToImport.length - 10} more` : '';
                const confirmMsg = `Found ${studentsToImport.length} student(s) to import:\n\n${preview}${moreText}\n\nContinue?`;
                
                if (!confirm(confirmMsg)) {
                    event.target.value = '';
                    return;
                }

                // Get existing students to check for duplicates (case-insensitive name matching)
                const existingStudents = await this.getAll('students');
                const existingNames = new Set(existingStudents.map(s => s.name.toLowerCase().trim()));

                let added = 0;
                let skipped = 0;
                const skippedNames = [];

                for (const studentData of studentsToImport) {
                    const nameLower = studentData.name.toLowerCase().trim();
                    
                    // Check for duplicates (case-insensitive)
                    if (existingNames.has(nameLower)) {
                        skipped++;
                        skippedNames.push(studentData.name);
                        continue;
                    }

                    const student = {
                        name: studentData.name.trim(),
                        grade: studentData.grade || null,
                        iep: null,
                        courseIds: [],
                        createdAt: new Date().toISOString()
                    };

                    await this.add('students', student);
                    existingNames.add(nameLower); // Add to set to prevent duplicates within the same import
                    added++;
                }

                // Show results
                let resultMsg = `Import complete!\n\nAdded: ${added} student(s)`;
                if (skipped > 0) {
                    resultMsg += `\nSkipped: ${skipped} duplicate(s)`;
                    if (skippedNames.length <= 5) {
                        resultMsg += `\n(${skippedNames.join(', ')})`;
                    } else {
                        resultMsg += `\n(${skippedNames.slice(0, 5).join(', ')} and ${skippedNames.length - 5} more)`;
                    }
                }
                alert(resultMsg);

                this.loadStudents();
                this.populateDropdowns();
                
            } catch (error) {
                alert('Error importing students: ' + error.message);
            }
            
            // Reset file input
            event.target.value = '';
        };
        
        reader.readAsText(file);
    }

    // Course Management
    async loadCourses() {
        const courses = await this.getAll('courses');
        const students = await this.getAll('students');
        const container = document.getElementById('courses-list');
        container.innerHTML = '';

        if (courses.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--secondary-color); padding: 40px;">No courses added yet. Click "Add Course" to get started.</p>';
            return;
        }

        // Sort courses using custom ordering, then by grade or name
        const sortedCourses = [...courses].sort((a, b) => {
            const orderA = this.getCourseOrderIndex(a.name);
            const orderB = this.getCourseOrderIndex(b.name);
            if (orderA !== orderB) return orderA - orderB;

            if (this.coursesSort === 'grade') {
                const gradeA = parseInt(a.grade) || 0;
                const gradeB = parseInt(b.grade) || 0;
                if (gradeA !== gradeB) return gradeA - gradeB;
            }
            // Default to name sort or as tiebreaker
            return (a.name || '').localeCompare(b.name || '');
        });

        // Update view class
        this.updateViewButtons('courses');

        sortedCourses.forEach(course => {
            const enrolledCount = (course.studentIds || []).length;

            const card = document.createElement('div');
            card.className = 'course-card';
            
            if (this.coursesView === 'list') {
                // List view - compact horizontal layout
                card.innerHTML = `
                    <div style="flex: 1; min-width: 200px;">
                        <h3 style="margin: 0 0 5px 0;">${this.escapeHtml(course.name)}</h3>
                        <div style="display: flex; gap: 15px; align-items: center; flex-wrap: wrap; font-size: 0.9rem; color: var(--secondary-color);">
                            <span><strong>Grade:</strong> ${course.grade}</span>
                            <span><strong>Competencies:</strong> ${course.competencies.length}</span>
                            <span><strong>Units:</strong> ${course.units}</span>
                            <span><strong>Students:</strong> ${enrolledCount}</span>
                        </div>
                    </div>
                    <div style="display: flex; gap: 5px; flex-wrap: wrap; align-items: center;">
                        <button class="btn btn-secondary" onclick="tracker.editCourse(${course.id})">Edit</button>
                        <button class="btn btn-primary" onclick="tracker.manageCourseStudents(${course.id})" style="font-size: 0.9rem; padding: 8px 12px;">Manage</button>
                        <button class="btn btn-primary" onclick="tracker.bulkEnrollStudents(${course.id})" style="font-size: 0.9rem; padding: 8px 12px; background: linear-gradient(135deg, var(--pride-green) 0%, var(--pride-blue) 100%);">📥 Bulk</button>
                        <button class="btn btn-danger" onclick="tracker.deleteCourse(${course.id})">Delete</button>
                    </div>
                `;
            } else {
                // Icon/card view - original layout
                card.innerHTML = `
                    <h3>${this.escapeHtml(course.name)}</h3>
                    <p><strong>Grade:</strong> ${course.grade}</p>
                    <p><strong>Competencies:</strong> ${course.competencies.length}</p>
                    <p><strong>Units:</strong> ${course.units}</p>
                    <div style="margin-top: 10px; margin-bottom: 10px;">
                        <strong>Students:</strong> ${enrolledCount}
                    </div>
                    <div style="margin-top: 15px; display: flex; gap: 5px; flex-wrap: wrap;">
                        <button class="btn btn-secondary" onclick="tracker.editCourse(${course.id})">Edit</button>
                        <button class="btn btn-primary" onclick="tracker.manageCourseStudents(${course.id})" style="font-size: 0.9rem; padding: 8px 12px;">Manage Students</button>
                        <button class="btn btn-primary" onclick="tracker.bulkEnrollStudents(${course.id})" style="font-size: 0.9rem; padding: 8px 12px; background: linear-gradient(135deg, var(--pride-green) 0%, var(--pride-blue) 100%);">📥 Bulk Enroll</button>
                        <button class="btn btn-danger" onclick="tracker.deleteCourse(${course.id})">Delete</button>
                    </div>
                `;
            }
            container.appendChild(card);
        });
    }

    showCourseModal(courseId = null) {
        this.currentCourseId = courseId;
        const modal = document.getElementById('course-modal');
        const form = document.getElementById('course-form');
        const title = document.getElementById('course-modal-title');
        const competenciesList = document.getElementById('competencies-list');
        const competenciesLabel = document.getElementById('competencies-label');
        competenciesList.innerHTML = '';

        if (courseId) {
            title.textContent = 'Edit Course';
            this.get('courses', courseId).then(course => {
                document.getElementById('course-name').value = course.name;
                document.getElementById('course-grade').value = course.grade;
                document.getElementById('course-units').value = course.units;
                
                const isTermComment = this.isTermCommentCourse(course.name);
                const addBtn = document.getElementById('add-competency-btn');
                if (isTermComment) {
                    // Update label and button
                    if (competenciesLabel) {
                        competenciesLabel.textContent = 'Behaviours for Success:';
                    }
                    addBtn.textContent = '+ Add Behaviour';
                    addBtn.onclick = () => this.addBehaviourField();
                    // Load behaviours (stored in competencies field for Term Comment courses)
                    if (course.competencies && course.competencies.length > 0) {
                        course.competencies.forEach((behaviour, index) => {
                            this.addBehaviourField(behaviour, index);
                        });
                    } else {
                        // Default behaviours for Term Comment courses
                        this.addBehaviourField('Takes an active role in their learning by consistently accessing resources and support');
                        this.addBehaviourField('Completes assignments in a timely manner');
                        this.addBehaviourField('Conduct is respectful and focused');
                        this.addBehaviourField('Accepts feedback and makes corrections');
                        this.addBehaviourField('Attends ILC and/or communicates with the school regularly');
                    }
                    document.getElementById('course-units').value = 0;
                } else {
                    // Update label and button
                    if (competenciesLabel) {
                        competenciesLabel.textContent = 'Curricular Competencies:';
                    }
                    addBtn.textContent = '+ Add Competency';
                    addBtn.onclick = () => this.addCompetencyField();
                    course.competencies.forEach((comp, index) => {
                        this.addCompetencyField(comp, index);
                    });
                }
            });
        } else {
            title.textContent = 'Add Course';
            form.reset();
            document.getElementById('course-units').value = 11;
            // Update label
            if (competenciesLabel) {
                competenciesLabel.textContent = 'Curricular Competencies:';
            }
            // Add default competencies based on BC curriculum
            this.addCompetencyField('Access information for diverse purposes and from a variety of sources to inform writing');
            this.addCompetencyField('Construct meaningful personal connections between self, text, and world');
        }

        // Watch for course name changes to detect Term Comment courses
        const nameInput = document.getElementById('course-name');
        const addBtn = document.getElementById('add-competency-btn');
        const updateFormForTermComment = () => {
            const courseName = nameInput.value.trim();
            const isTermComment = this.isTermCommentCourse(courseName);
            
            if (isTermComment) {
                if (competenciesLabel) competenciesLabel.textContent = 'Behaviours for Success:';
                document.getElementById('course-units').value = 0;
                addBtn.textContent = '+ Add Behaviour';
                addBtn.onclick = () => this.addBehaviourField();
                // If list is empty, add default behaviours
                if (competenciesList.children.length === 0) {
                    this.addBehaviourField('Takes an active role in their learning by consistently accessing resources and support');
                    this.addBehaviourField('Completes assignments in a timely manner');
                    this.addBehaviourField('Conduct is respectful and focused');
                    this.addBehaviourField('Accepts feedback and makes corrections');
                    this.addBehaviourField('Attends ILC and/or communicates with the school regularly');
                }
            } else {
                if (competenciesLabel) competenciesLabel.textContent = 'Curricular Competencies:';
                if (document.getElementById('course-units').value === '0') {
                    document.getElementById('course-units').value = 11;
                }
                addBtn.textContent = '+ Add Competency';
                addBtn.onclick = () => this.addCompetencyField();
            }
        };
        
        // Remove old listener and add new one
        nameInput.oninput = updateFormForTermComment;

        modal.style.display = 'block';
    }

    isTermCommentCourse(courseName) {
        return courseName && (courseName === 'Term Comment 10' || courseName === 'Term Comment 11' || courseName === 'Term Comment 12');
    }

    addCompetencyField(value = '', index = null) {
        const container = document.getElementById('competencies-list');
        const div = document.createElement('div');
        div.className = 'competency-item';
        const inputId = `competency-${index !== null ? index : Date.now()}`;
        div.innerHTML = `
            <input type="text" id="${inputId}" class="form-control" value="${this.escapeHtml(value)}" placeholder="Enter competency description">
            <button type="button" class="btn btn-danger" onclick="this.parentElement.remove()">Remove</button>
        `;
        container.appendChild(div);
    }

    addBehaviourField(value = '', index = null) {
        const container = document.getElementById('competencies-list');
        const div = document.createElement('div');
        div.className = 'competency-item';
        const inputId = `behaviour-${index !== null ? index : Date.now()}`;
        div.innerHTML = `
            <input type="text" id="${inputId}" class="form-control" value="${this.escapeHtml(value)}" placeholder="Enter behaviour description">
            <button type="button" class="btn btn-danger" onclick="this.parentElement.remove()">Remove</button>
        `;
        container.appendChild(div);
    }

    async saveCourse() {
        const name = document.getElementById('course-name').value.trim();
        const grade = document.getElementById('course-grade').value;
        const isTermComment = this.isTermCommentCourse(name);
        const units = isTermComment ? 0 : (parseInt(document.getElementById('course-units').value) || 11);

        if (!name) {
            alert('Please enter a course name');
            return;
        }

        const competencyInputs = document.querySelectorAll('#competencies-list input');
        const competencies = Array.from(competencyInputs)
            .map(input => input.value.trim())
            .filter(comp => comp.length > 0);

        if (competencies.length === 0) {
            const fieldName = isTermComment ? 'behaviour' : 'curricular competency';
            alert(`Please add at least one ${fieldName}`);
            return;
        }

        const existingCourse = this.currentCourseId ? await this.get('courses', this.currentCourseId) : null;
        const course = {
            name,
            grade,
            units,
            competencies,
            isTermComment: isTermComment,
            studentIds: existingCourse?.studentIds || [],
            createdAt: existingCourse?.createdAt || new Date().toISOString()
        };

        if (this.currentCourseId) {
            course.id = this.currentCourseId;
            await this.update('courses', course);
        } else {
            await this.add('courses', course);
        }

        this.closeModal('course-modal');
        this.loadCourses();
        this.populateDropdowns();
    }

    async editCourse(id) {
        this.showCourseModal(id);
    }

    async deleteCourse(id) {
        if (!this.verifyPassword()) {
            alert('Incorrect password. Action cancelled.');
            return;
        }
        
        if (confirm('Are you sure you want to delete this course? All associated records will also be deleted.')) {
            await this.delete('courses', id);
            // Also delete associated records
            const records = await this.getAll('records');
            const courseRecords = records.filter(r => r.courseId === id);
            for (const record of courseRecords) {
                await this.delete('records', record.id);
            }
            // Remove course from all students
            const students = await this.getAll('students');
            for (const student of students) {
                if (student.courseIds && student.courseIds.includes(id)) {
                    student.courseIds = student.courseIds.filter(cid => cid !== id);
                    await this.update('students', student);
                }
            }
            this.loadCourses();
            this.populateDropdowns();
        }
    }

    async manageStudentCourses(studentId) {
        const student = await this.get('students', studentId);
        const courses = await this.getAll('courses');
        const enrolledCourseIds = student.courseIds || [];

        let html = `
            <div style="background: var(--card-bg); padding: 25px; border-radius: 8px; box-shadow: var(--shadow-lg); max-width: 600px; margin: 5% auto;">
                <h2 style="margin-bottom: 20px;">Manage Courses for ${this.escapeHtml(student.name)}</h2>
                <div style="max-height: 400px; overflow-y: auto; margin-bottom: 20px;">
        `;

        courses.forEach(course => {
            const isEnrolled = enrolledCourseIds.includes(course.id);
            html += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; margin-bottom: 8px; background: var(--bg-color); border-radius: 6px;">
                    <div>
                        <strong>${this.escapeHtml(course.name)}</strong> (Grade ${course.grade})
                    </div>
                    <label style="display: flex; align-items: center; cursor: pointer;">
                        <input type="checkbox" ${isEnrolled ? 'checked' : ''} 
                               onchange="tracker.toggleStudentCourse(${studentId}, ${course.id}, this.checked)"
                               style="margin-right: 8px; width: 18px; height: 18px; cursor: pointer;">
                        <span>Enrolled</span>
                    </label>
                </div>
            `;
        });

        html += `
                </div>
                <button class="btn btn-secondary" onclick="this.closest('div').style.display='none'" style="width: 100%;">Close</button>
            </div>
        `;

        // Create or update modal
        let modal = document.getElementById('enrollment-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'enrollment-modal';
            modal.className = 'modal';
            modal.style.display = 'block';
            document.body.appendChild(modal);
        } else {
            modal.style.display = 'block';
        }
        modal.innerHTML = html;

        // Close on outside click (backdrop)
        modal.onclick = (e) => {
            if (e.target === modal || e.target.classList.contains('modal')) {
                modal.style.display = 'none';
            }
        };
        
        // Prevent clicks inside modal content from closing
        const modalContent = modal.querySelector('div[style*="background"]');
        if (modalContent) {
            modalContent.onclick = (e) => {
                e.stopPropagation();
            };
        }
    }

    async toggleStudentCourse(studentId, courseId, isEnrolled) {
        const student = await this.get('students', studentId);
        const course = await this.get('courses', courseId);

        if (!student.courseIds) student.courseIds = [];
        if (!course.studentIds) course.studentIds = [];

        if (isEnrolled) {
            if (!student.courseIds.includes(courseId)) {
                student.courseIds.push(courseId);
            }
            if (!course.studentIds.includes(studentId)) {
                course.studentIds.push(studentId);
            }
        } else {
            student.courseIds = student.courseIds.filter(id => id !== courseId);
            course.studentIds = course.studentIds.filter(id => id !== studentId);
        }

        await this.update('students', student);
        await this.update('courses', course);
        this.loadStudents();
        this.loadCourses();
    }

    async manageCourseStudents(courseId) {
        const course = await this.get('courses', courseId);
        const students = await this.getAll('students');
        const enrolledStudentIds = course.studentIds || [];

        let html = `
            <div style="background: var(--card-bg); padding: 25px; border-radius: 8px; box-shadow: var(--shadow-lg); max-width: 600px; margin: 5% auto;">
                <h2 style="margin-bottom: 20px;">Manage Students for ${this.escapeHtml(course.name)}</h2>
                <div style="max-height: 400px; overflow-y: auto; margin-bottom: 20px;">
        `;

        students.forEach(student => {
            const isEnrolled = enrolledStudentIds.includes(student.id);
            html += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; margin-bottom: 8px; background: var(--bg-color); border-radius: 6px;">
                    <div>
                        <strong>${this.escapeHtml(student.name)}</strong>
                        ${student.iep ? `<span class="badge badge-${student.iep.toLowerCase()}" style="margin-left: 8px;">${student.iep === 'I' ? 'IEP' : 'SSP'}</span>` : ''}
                    </div>
                    <label style="display: flex; align-items: center; cursor: pointer;">
                        <input type="checkbox" ${isEnrolled ? 'checked' : ''} 
                               onchange="tracker.toggleCourseStudent(${courseId}, ${student.id}, this.checked)"
                               style="margin-right: 8px; width: 18px; height: 18px; cursor: pointer;">
                        <span>Enrolled</span>
                    </label>
                </div>
            `;
        });

        html += `
                </div>
                <button class="btn btn-secondary" onclick="this.closest('div').style.display='none'" style="width: 100%;">Close</button>
            </div>
        `;

        // Create or update modal
        let modal = document.getElementById('enrollment-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'enrollment-modal';
            modal.className = 'modal';
            modal.style.display = 'block';
            document.body.appendChild(modal);
        } else {
            modal.style.display = 'block';
        }
        modal.innerHTML = html;

        // Close on outside click (backdrop)
        modal.onclick = (e) => {
            if (e.target === modal || e.target.classList.contains('modal')) {
                modal.style.display = 'none';
            }
        };
        
        // Prevent clicks inside modal content from closing
        const modalContent = modal.querySelector('div[style*="background"]');
        if (modalContent) {
            modalContent.onclick = (e) => {
                e.stopPropagation();
            };
        }
    }

    async toggleCourseStudent(courseId, studentId, isEnrolled) {
        const course = await this.get('courses', courseId);
        const student = await this.get('students', studentId);

        if (!course.studentIds) course.studentIds = [];
        if (!student.courseIds) student.courseIds = [];

        if (isEnrolled) {
            if (!course.studentIds.includes(studentId)) {
                course.studentIds.push(studentId);
            }
            if (!student.courseIds.includes(courseId)) {
                student.courseIds.push(courseId);
            }
        } else {
            course.studentIds = course.studentIds.filter(id => id !== studentId);
            student.courseIds = student.courseIds.filter(id => id !== courseId);
        }

        await this.update('courses', course);
        await this.update('students', student);
        this.loadStudents();
        this.loadCourses();
    }

    async bulkEnrollStudents(courseId) {
        const course = await this.get('courses', courseId);
        
        // Create a file input dynamically
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.csv,.txt';
        fileInput.style.display = 'none';
        
        fileInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) {
                document.body.removeChild(fileInput);
                return;
            }

            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const text = event.target.result;
                    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
                    
                    if (lines.length === 0) {
                        alert('File is empty or contains no valid student names.');
                        document.body.removeChild(fileInput);
                        return;
                    }

                    // Check if first line looks like a header
                    let startIndex = 0;
                    if (lines[0].toLowerCase().includes('name') || lines[0].includes(',')) {
                        startIndex = 1;
                    }

                    const studentNames = [];
                    for (let i = startIndex; i < lines.length; i++) {
                        const line = lines[i];
                        let name = line;
                        if (line.includes(',')) {
                            const parts = line.split(',').map(p => p.trim());
                            if (parts.length >= 2) {
                                name = `${parts[1]} ${parts[0]}`;
                            } else {
                                name = parts[0];
                            }
                        }
                        if (name && name.length > 0) {
                            studentNames.push(name.trim());
                        }
                    }

                    if (studentNames.length === 0) {
                        alert('No valid student names found in file.');
                        document.body.removeChild(fileInput);
                        return;
                    }

                    // Get all students
                    const allStudents = await this.getAll('students');
                    const enrolledStudentIds = course.studentIds || [];
                    
                    let enrolled = 0;
                    let notFound = 0;
                    let alreadyEnrolled = 0;
                    const notFoundNames = [];
                    const alreadyEnrolledNames = [];

                    for (const name of studentNames) {
                        // Find matching student (case-insensitive)
                        const student = allStudents.find(s => 
                            s.name.toLowerCase() === name.toLowerCase() ||
                            s.name.toLowerCase().includes(name.toLowerCase()) ||
                            name.toLowerCase().includes(s.name.toLowerCase())
                        );

                        if (!student) {
                            notFound++;
                            notFoundNames.push(name);
                            continue;
                        }

                        if (enrolledStudentIds.includes(student.id)) {
                            alreadyEnrolled++;
                            alreadyEnrolledNames.push(student.name);
                            continue;
                        }

                        // Enroll student
                        if (!course.studentIds) course.studentIds = [];
                        if (!student.courseIds) student.courseIds = [];
                        
                        course.studentIds.push(student.id);
                        student.courseIds.push(courseId);
                        
                        await this.update('courses', course);
                        await this.update('students', student);
                        
                        enrolled++;
                    }

                    // Show results
                    let resultMsg = `Bulk enrollment complete for ${this.escapeHtml(course.name)}!\n\n`;
                    resultMsg += `✅ Enrolled: ${enrolled} student(s)\n`;
                    
                    if (alreadyEnrolled > 0) {
                        resultMsg += `⏭️ Already enrolled: ${alreadyEnrolled}`;
                        if (alreadyEnrolledNames.length <= 5) {
                            resultMsg += `\n(${alreadyEnrolledNames.join(', ')})`;
                        }
                        resultMsg += `\n`;
                    }
                    
                    if (notFound > 0) {
                        resultMsg += `❌ Not found: ${notFound}`;
                        if (notFoundNames.length <= 5) {
                            resultMsg += `\n(${notFoundNames.join(', ')})`;
                        }
                    }

                    alert(resultMsg);

                    this.loadCourses();
                    this.loadStudents();
                    
                } catch (error) {
                    alert('Error enrolling students: ' + error.message);
                }
                
                document.body.removeChild(fileInput);
            };
            
            reader.readAsText(file);
        };
        
        document.body.appendChild(fileInput);
        fileInput.click();
    }

    // Record Competencies
    async populateDropdowns() {
        const students = await this.getAll('students');
        const courses = await this.getAll('courses');

        const studentSelect = document.getElementById('record-student');
        const courseSelect = document.getElementById('record-course');

        // Populate student dropdown for record tab
        if (studentSelect) {
            studentSelect.innerHTML = '<option value="">Select a student</option>';
            students.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            students.forEach(student => {
                const option = document.createElement('option');
                option.value = student.id;
                option.textContent = student.name;
                studentSelect.appendChild(option);
            });
        }

        // Populate course dropdown for reports (if it exists)
        if (courseSelect) {
            courseSelect.innerHTML = '<option value="">Select a course</option>';
            courses.forEach(course => {
                const option = document.createElement('option');
                option.value = course.id;
                option.textContent = `${course.name} (Grade ${course.grade})`;
                courseSelect.appendChild(option);
            });
        }
    }

    async updateStudentDropdownForCourse() {
        const courseId = parseInt(document.getElementById('record-course').value);
        const studentSelect = document.getElementById('record-student');
        
        // Clear current selection
        studentSelect.innerHTML = '<option value="">Select a student</option>';
        
        if (!courseId) {
            studentSelect.innerHTML = '<option value="">Select a course first</option>';
            return;
        }

        const course = await this.get('courses', courseId);
        const allStudents = await this.getAll('students');
        
        // Get enrolled student IDs for this course
        const enrolledStudentIds = course.studentIds || [];
        
        // Filter students to only those enrolled in the course
        const enrolledStudents = allStudents.filter(student => 
            enrolledStudentIds.includes(student.id)
        );
        
        // Sort students alphabetically
        enrolledStudents.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        
        if (enrolledStudents.length === 0) {
            studentSelect.innerHTML = '<option value="">No students enrolled in this course</option>';
            return;
        }
        
        enrolledStudents.forEach(student => {
            const option = document.createElement('option');
            option.value = student.id;
            option.textContent = student.name;
            studentSelect.appendChild(option);
        });
    }

    async loadStudentCourses() {
        const studentId = parseInt(document.getElementById('record-student').value);
        const container = document.getElementById('student-courses-container');
        
        if (!studentId) {
            container.innerHTML = '';
            return;
        }

        const student = await this.get('students', studentId);
        const allCourses = await this.getAll('courses');
        const enrolledCourses = allCourses.filter(c => (c.studentIds || []).includes(studentId));
        
        if (enrolledCourses.length === 0) {
            container.innerHTML = '<p style="color: var(--secondary-color); padding: 20px; text-align: center;">This student is not enrolled in any courses.</p>';
            return;
        }

        // Sort courses by custom order
        enrolledCourses.sort((a, b) => {
            const orderA = this.getCourseOrderIndex(a.name);
            const orderB = this.getCourseOrderIndex(b.name);
            if (orderA !== orderB) return orderA - orderB;
            return (a.name || '').localeCompare(b.name || '');
        });

        let html = '';
        for (const course of enrolledCourses) {
            html += await this.renderCourseForm(studentId, course);
        }
        
        container.innerHTML = html;
        
        // Load existing records for all courses
        for (const course of enrolledCourses) {
            await this.loadExistingRecordForCourse(studentId, course.id);
        }
        
        // Store original form states for change detection
        this.storeOriginalFormStates(studentId);
    }

    async renderCourseForm(studentId, course) {
        const stockComments = await this.getAll('stockComments');
        const isTermComment = this.isTermCommentCourse(course.name);
        const courseId = course.id;

        let html = `
            <div class="course-record-form" data-course-id="${courseId}" data-student-id="${studentId}">
                <div class="course-record-header">
                    <h3>${this.escapeHtml(course.name)}</h3>
                </div>
        `;

        if (isTermComment) {
            // For Term Comment courses, show behaviours instead of competencies
            html += `
                <div class="competency-grid">
                    <h4>Behaviours for Success</h4>
            `;

            course.competencies.forEach((behaviour, index) => {
                html += `
                    <div class="competency-row">
                        <label>${this.escapeHtml(behaviour)}:</label>
                        <select class="form-control behaviour-level" data-behaviour="${index}" data-course-id="${courseId}">
                            <option value="">Not Assessed</option>
                            <option value="R">Rarely</option>
                            <option value="S">Sometimes</option>
                            <option value="C">Consistently</option>
                        </select>
                    </div>
                `;
            });

            html += `</div>`;
        } else {
            // For regular courses, show competencies
            html += `
                <div class="competency-grid">
                    <h4>Curricular Competencies</h4>
            `;

            course.competencies.forEach((competency, index) => {
                html += `
                    <div class="competency-row">
                        <label>${this.escapeHtml(competency)}:</label>
                        <select class="form-control competency-level" data-competency="${index}" data-course-id="${courseId}">
                            <option value="">Not Assessed</option>
                            <option value="E">Emerging</option>
                            <option value="D">Developing</option>
                            <option value="P">Proficient</option>
                            <option value="X">Extending</option>
                            <option value="0">No Evidence</option>
                        </select>
                    </div>
                `;
            });

            html += `</div>`;
        }

        // Units complete - only show if course has units > 0
        if (course.units > 0) {
            html += `
                <div class="form-group" style="margin-top: 20px;">
                    <label for="units-complete-${courseId}">Units Complete:</label>
                    <input type="number" id="units-complete-${courseId}" class="form-control" min="0" max="${course.units}" value="0">
                    <small>/ ${course.units}</small>
                </div>
            `;
        }
        
        html += `
            <div class="form-group" style="margin-top: 20px;">
                <label for="stock-comment-1-${courseId}">Stock Comment 1:</label>
                <select id="stock-comment-1-${courseId}" class="form-control">
                    <option value="">None</option>
                    ${stockComments.map(sc => `<option value="${sc.id}">${this.escapeHtml(sc.text)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label for="stock-comment-2-${courseId}">Stock Comment 2:</label>
                <select id="stock-comment-2-${courseId}" class="form-control">
                    <option value="">None</option>
                    ${stockComments.map(sc => `<option value="${sc.id}">${this.escapeHtml(sc.text)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label for="custom-comment-${courseId}">Additional Comments:</label>
                <textarea id="custom-comment-${courseId}" class="form-control" rows="3" placeholder="Enter additional comments..."></textarea>
            </div>
            <div class="form-group">
                <label for="term-grade-${courseId}">Term/Final Grade:</label>
                <input type="text" id="term-grade-${courseId}" class="form-control" placeholder="e.g., A, B, C, or percentage">
            </div>
            <div class="form-group">
                <label for="date-completed-${courseId}">Date Completed:</label>
                <input type="date" id="date-completed-${courseId}" class="form-control">
            </div>
            <div class="form-actions" style="margin-top: 15px;">
                <button type="button" class="btn btn-primary" onclick="tracker.saveRecordForCourse(${studentId}, ${courseId})">Save Record</button>
            </div>
        </div>
        `;

        return html;
    }

    async loadRecordForm() {
        const studentId = parseInt(document.getElementById('record-student').value);
        const courseId = parseInt(document.getElementById('record-course').value);

        if (!studentId || !courseId) {
            document.getElementById('competency-form').innerHTML = '';
            return;
        }

        const course = await this.get('courses', courseId);
        const student = await this.get('students', studentId);
        const stockComments = await this.getAll('stockComments');
        const isTermComment = this.isTermCommentCourse(course.name);

        let html = '';

        if (isTermComment) {
            // For Term Comment courses, show behaviours instead of competencies
            html += `
                <div class="competency-grid">
                    <h3>Behaviours for Success</h3>
            `;

            course.competencies.forEach((behaviour, index) => {
                html += `
                    <div class="competency-row">
                        <label>${this.escapeHtml(behaviour)}:</label>
                        <select class="form-control behaviour-level" data-behaviour="${index}">
                            <option value="">Not Assessed</option>
                            <option value="R">Rarely</option>
                            <option value="S">Sometimes</option>
                            <option value="C">Consistently</option>
                        </select>
                    </div>
                `;
            });

            html += `</div>`;
        } else {
            // For regular courses, show competencies
            html += `
                <div class="competency-grid">
                    <h3>Curricular Competencies</h3>
            `;

            course.competencies.forEach((competency, index) => {
                html += `
                    <div class="competency-row">
                        <label>${this.escapeHtml(competency)}:</label>
                        <select class="form-control competency-level" data-competency="${index}">
                            <option value="">Not Assessed</option>
                            <option value="E">Emerging</option>
                            <option value="D">Developing</option>
                            <option value="P">Proficient</option>
                            <option value="X">Extending</option>
                            <option value="0">No Evidence</option>
                        </select>
                    </div>
                `;
            });

            html += `</div>`;
        }

        // Units complete - only show if course has units > 0
        if (course.units > 0) {
            html += `
                <div class="form-group" style="margin-top: 30px;">
                    <label for="units-complete">Units Complete:</label>
                    <input type="number" id="units-complete" class="form-control" min="0" max="${course.units}" value="0">
                    <small>/ ${course.units}</small>
                </div>
            `;
        }
        
        html += `
            <div class="form-group" style="margin-top: 30px;">
                <label for="stock-comment-1">Stock Comment 1:</label>
                <select id="stock-comment-1" class="form-control">
                    <option value="">None</option>
                    ${stockComments.map(sc => `<option value="${sc.id}">${this.escapeHtml(sc.text)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label for="stock-comment-2">Stock Comment 2:</label>
                <select id="stock-comment-2" class="form-control">
                    <option value="">None</option>
                    ${stockComments.map(sc => `<option value="${sc.id}">${this.escapeHtml(sc.text)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label for="custom-comment">Additional Comments:</label>
                <textarea id="custom-comment" class="form-control" rows="4" placeholder="Enter additional comments..."></textarea>
            </div>
            <div class="form-group">
                <label for="term-grade">Term/Final Grade:</label>
                <input type="text" id="term-grade" class="form-control" placeholder="e.g., A, B, C, or percentage">
            </div>
            <div class="form-group">
                <label for="date-completed">Date Completed:</label>
                <input type="date" id="date-completed" class="form-control">
            </div>
            <div class="form-actions" style="margin-top: 20px;">
                <button type="button" class="btn btn-primary" onclick="tracker.saveRecord()">Save Record</button>
                <button type="button" class="btn btn-secondary" onclick="tracker.copyToAspen()">Copy to Aspen</button>
            </div>
        `;

        document.getElementById('competency-form').innerHTML = html;

        // Load existing record if available
        this.loadExistingRecord(studentId, courseId);
    }

    async loadExistingRecordForCourse(studentId, courseId) {
        const records = await this.getAll('records');
        const existing = records.find(r => r.studentId === studentId && r.courseId === courseId);
        const course = await this.get('courses', courseId);
        const isTermComment = this.isTermCommentCourse(course.name);

        if (existing) {
            if (isTermComment) {
                // For Term Comment courses, behaviours are stored in competencies array
                existing.competencies.forEach((level, index) => {
                    const select = document.querySelector(`[data-behaviour="${index}"][data-course-id="${courseId}"]`);
                    if (select) select.value = level;
                });
            } else {
                // For regular courses, populate competency levels
                existing.competencies.forEach((level, index) => {
                    const select = document.querySelector(`[data-competency="${index}"][data-course-id="${courseId}"]`);
                    if (select) select.value = level;
                });
            }

            if (existing.unitsComplete !== undefined && course.units > 0) {
                const unitsInput = document.getElementById(`units-complete-${courseId}`);
                if (unitsInput) unitsInput.value = existing.unitsComplete;
            }
            if (existing.stockComment1) {
                const sc1Input = document.getElementById(`stock-comment-1-${courseId}`);
                if (sc1Input) sc1Input.value = existing.stockComment1;
            }
            if (existing.stockComment2) {
                const sc2Input = document.getElementById(`stock-comment-2-${courseId}`);
                if (sc2Input) sc2Input.value = existing.stockComment2;
            }
            if (existing.comments) {
                const commentInput = document.getElementById(`custom-comment-${courseId}`);
                if (commentInput) commentInput.value = existing.comments;
            }
            if (existing.termGrade) {
                const gradeInput = document.getElementById(`term-grade-${courseId}`);
                if (gradeInput) gradeInput.value = existing.termGrade;
            }
            if (existing.dateCompleted) {
                const dateInput = document.getElementById(`date-completed-${courseId}`);
                if (dateInput) dateInput.value = existing.dateCompleted;
            }
        }
    }

    async loadExistingRecord(studentId, courseId) {
        const records = await this.getAll('records');
        const existing = records.find(r => r.studentId === studentId && r.courseId === courseId);
        const course = await this.get('courses', courseId);
        const isTermComment = this.isTermCommentCourse(course.name);

        if (existing) {
            if (isTermComment) {
                // For Term Comment courses, behaviours are stored in competencies array
                existing.competencies.forEach((level, index) => {
                    const select = document.querySelector(`[data-behaviour="${index}"]`);
                    if (select) select.value = level;
                });
            } else {
                // For regular courses, populate competency levels
                existing.competencies.forEach((level, index) => {
                    const select = document.querySelector(`[data-competency="${index}"]`);
                    if (select) select.value = level;
                });
            }

            if (existing.unitsComplete !== undefined && course.units > 0) {
                const unitsInput = document.getElementById('units-complete');
                if (unitsInput) unitsInput.value = existing.unitsComplete;
            }
            if (existing.stockComment1) {
                document.getElementById('stock-comment-1').value = existing.stockComment1;
            }
            if (existing.stockComment2) {
                document.getElementById('stock-comment-2').value = existing.stockComment2;
            }
            if (existing.comments) {
                document.getElementById('custom-comment').value = existing.comments;
            }
            if (existing.termGrade) {
                document.getElementById('term-grade').value = existing.termGrade;
            }
            if (existing.dateCompleted) {
                document.getElementById('date-completed').value = existing.dateCompleted;
            }
        }
    }

    async saveRecordForCourse(studentId, courseId, suppressAlert = false) {
        if (!studentId || !courseId) {
            if (!suppressAlert) {
                alert('Please select a student and course');
            }
            return;
        }

        const course = await this.get('courses', courseId);
        const isTermComment = this.isTermCommentCourse(course.name);
        
        let competencies = [];

        if (isTermComment) {
            // For Term Comment courses, behaviours are stored in competencies array
            competencies = Array.from(document.querySelectorAll(`.behaviour-level[data-course-id="${courseId}"]`)).map(select => select.value);
        } else {
            // For regular courses, competencies go in competencies array
            competencies = Array.from(document.querySelectorAll(`.competency-level[data-course-id="${courseId}"]`)).map(select => select.value);
        }

        const unitsInput = document.getElementById(`units-complete-${courseId}`);
        const stockComment1Input = document.getElementById(`stock-comment-1-${courseId}`);
        const stockComment2Input = document.getElementById(`stock-comment-2-${courseId}`);
        const customCommentInput = document.getElementById(`custom-comment-${courseId}`);
        const termGradeInput = document.getElementById(`term-grade-${courseId}`);
        const dateCompletedInput = document.getElementById(`date-completed-${courseId}`);

        const record = {
            studentId: studentId,
            courseId: courseId,
            competencies: competencies,
            unitsComplete: course.units > 0 && unitsInput ? (parseInt(unitsInput.value) || 0) : 0,
            stockComment1: stockComment1Input ? (parseInt(stockComment1Input.value) || null) : null,
            stockComment2: stockComment2Input ? (parseInt(stockComment2Input.value) || null) : null,
            comments: customCommentInput ? (customCommentInput.value.trim() || null) : null,
            termGrade: termGradeInput ? (termGradeInput.value.trim() || null) : null,
            dateCompleted: dateCompletedInput ? (dateCompletedInput.value || null) : null,
            date: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Check if record already exists
        const records = await this.getAll('records');
        const existing = records.find(r => r.studentId === studentId && r.courseId === courseId);

        if (existing) {
            record.id = existing.id;
            await this.update('records', record);
        } else {
            await this.add('records', record);
        }

        // Celebrate if a completion date is entered!
        if (record.dateCompleted) {
            this.showUnicornCelebration();
        }

        if (!suppressAlert) {
            alert('Record saved successfully!');
        }
        
        // Update original form state after saving
        this.storeOriginalFormStateForCourse(studentId, courseId);
    }

    // Store original form states for all courses of a student
    async storeOriginalFormStates(studentId) {
        const container = document.getElementById('student-courses-container');
        if (!container) return;

        const allCourses = await this.getAll('courses');
        const enrolledCourses = allCourses.filter(c => (c.studentIds || []).includes(studentId));

        for (const course of enrolledCourses) {
            await this.storeOriginalFormStateForCourse(studentId, course.id);
        }
    }

    // Store original form state for a specific course
    async storeOriginalFormStateForCourse(studentId, courseId) {
        const course = await this.get('courses', courseId);
        if (!course) return;

        const isTermComment = this.isTermCommentCourse(course.name);
        let competencies = [];

        if (isTermComment) {
            competencies = Array.from(document.querySelectorAll(`.behaviour-level[data-course-id="${courseId}"]`)).map(select => select.value);
        } else {
            competencies = Array.from(document.querySelectorAll(`.competency-level[data-course-id="${courseId}"]`)).map(select => select.value);
        }

        const unitsInput = document.getElementById(`units-complete-${courseId}`);
        const stockComment1Input = document.getElementById(`stock-comment-1-${courseId}`);
        const stockComment2Input = document.getElementById(`stock-comment-2-${courseId}`);
        const customCommentInput = document.getElementById(`custom-comment-${courseId}`);
        const termGradeInput = document.getElementById(`term-grade-${courseId}`);
        const dateCompletedInput = document.getElementById(`date-completed-${courseId}`);

        const stateKey = `${studentId}-${courseId}`;
        this.originalFormStates.set(stateKey, {
            competencies: competencies,
            unitsComplete: course.units > 0 && unitsInput ? (parseInt(unitsInput.value) || 0) : 0,
            stockComment1: stockComment1Input ? (parseInt(stockComment1Input.value) || null) : null,
            stockComment2: stockComment2Input ? (parseInt(stockComment2Input.value) || null) : null,
            comments: customCommentInput ? (customCommentInput.value.trim() || null) : null,
            termGrade: termGradeInput ? (termGradeInput.value.trim() || null) : null,
            dateCompleted: dateCompletedInput ? (dateCompletedInput.value || null) : null
        });
    }

    // Get current form state for a specific course
    async getCurrentFormState(studentId, courseId) {
        const course = await this.get('courses', courseId);
        if (!course) return null;

        const isTermComment = this.isTermCommentCourse(course.name);
        let competencies = [];

        if (isTermComment) {
            competencies = Array.from(document.querySelectorAll(`.behaviour-level[data-course-id="${courseId}"]`)).map(select => select.value);
        } else {
            competencies = Array.from(document.querySelectorAll(`.competency-level[data-course-id="${courseId}"]`)).map(select => select.value);
        }

        const unitsInput = document.getElementById(`units-complete-${courseId}`);
        const stockComment1Input = document.getElementById(`stock-comment-1-${courseId}`);
        const stockComment2Input = document.getElementById(`stock-comment-2-${courseId}`);
        const customCommentInput = document.getElementById(`custom-comment-${courseId}`);
        const termGradeInput = document.getElementById(`term-grade-${courseId}`);
        const dateCompletedInput = document.getElementById(`date-completed-${courseId}`);

        return {
            competencies: competencies,
            unitsComplete: course.units > 0 && unitsInput ? (parseInt(unitsInput.value) || 0) : 0,
            stockComment1: stockComment1Input ? (parseInt(stockComment1Input.value) || null) : null,
            stockComment2: stockComment2Input ? (parseInt(stockComment2Input.value) || null) : null,
            comments: customCommentInput ? (customCommentInput.value.trim() || null) : null,
            termGrade: termGradeInput ? (termGradeInput.value.trim() || null) : null,
            dateCompleted: dateCompletedInput ? (dateCompletedInput.value || null) : null
        };
    }

    // Check if there are unsaved changes
    async checkForUnsavedChanges() {
        if (!this.currentStudentId) return false;

        const container = document.getElementById('student-courses-container');
        if (!container || container.innerHTML === '') return false;

        const allCourses = await this.getAll('courses');
        const enrolledCourses = allCourses.filter(c => (c.studentIds || []).includes(this.currentStudentId));

        for (const course of enrolledCourses) {
            const stateKey = `${this.currentStudentId}-${course.id}`;
            const originalState = this.originalFormStates.get(stateKey);
            
            if (!originalState) {
                // No original state stored, check if there's any data entered
                const currentState = await this.getCurrentFormState(this.currentStudentId, course.id);
                if (currentState && this.hasAnyData(currentState)) {
                    return true;
                }
                continue;
            }

            const currentState = await this.getCurrentFormState(this.currentStudentId, course.id);
            if (!currentState) continue;

            if (this.hasFormStateChanged(originalState, currentState)) {
                return true;
            }
        }

        return false;
    }

    // Check if form state has changed
    hasFormStateChanged(original, current) {
        // Compare competencies arrays
        if (JSON.stringify(original.competencies) !== JSON.stringify(current.competencies)) {
            return true;
        }

        // Compare other fields
        if (original.unitsComplete !== current.unitsComplete) return true;
        if (original.stockComment1 !== current.stockComment1) return true;
        if (original.stockComment2 !== current.stockComment2) return true;
        if ((original.comments || '') !== (current.comments || '')) return true;
        if ((original.termGrade || '') !== (current.termGrade || '')) return true;
        if ((original.dateCompleted || '') !== (current.dateCompleted || '')) return true;

        return false;
    }

    // Check if state has any data
    hasAnyData(state) {
        if (state.competencies && state.competencies.some(c => c && c.trim() !== '')) return true;
        if (state.unitsComplete > 0) return true;
        if (state.stockComment1) return true;
        if (state.stockComment2) return true;
        if (state.comments && state.comments.trim() !== '') return true;
        if (state.termGrade && state.termGrade.trim() !== '') return true;
        if (state.dateCompleted && state.dateCompleted.trim() !== '') return true;
        return false;
    }

    // Prompt user to save unsaved changes
    async promptSaveUnsavedChanges() {
        return new Promise((resolve) => {
            // Create a custom modal for better UX
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.display = 'block';
            modal.style.zIndex = '10000';
            
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 500px;">
                    <h2 style="margin-top: 0; color: var(--text-color);">Unsaved Changes</h2>
                    <p style="margin-bottom: 25px; color: var(--text-color);">
                        You have unsaved changes in the Record Competencies tab. What would you like to do?
                    </p>
                    <div class="form-actions" style="justify-content: flex-end; gap: 10px;">
                        <button class="btn btn-secondary" id="unsaved-cancel-btn" style="background: var(--secondary-color);">Cancel</button>
                        <button class="btn btn-danger" id="unsaved-discard-btn" style="background: #dc2626;">Discard Changes</button>
                        <button class="btn btn-primary" id="unsaved-save-btn">Save Changes</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // Close on backdrop click
            modal.onclick = (e) => {
                if (e.target === modal) {
                    document.body.removeChild(modal);
                    resolve('cancel');
                }
            };
            
            // Button handlers
            document.getElementById('unsaved-save-btn').onclick = () => {
                document.body.removeChild(modal);
                resolve('save');
            };
            
            document.getElementById('unsaved-discard-btn').onclick = () => {
                if (confirm('Are you sure you want to discard all unsaved changes?')) {
                    document.body.removeChild(modal);
                    resolve('discard');
                }
            };
            
            document.getElementById('unsaved-cancel-btn').onclick = () => {
                document.body.removeChild(modal);
                resolve('cancel');
            };
        });
    }

    // Save all unsaved changes
    async saveAllUnsavedChanges() {
        if (!this.currentStudentId) return;

        const allCourses = await this.getAll('courses');
        const enrolledCourses = allCourses.filter(c => (c.studentIds || []).includes(this.currentStudentId));

        let savedCount = 0;
        for (const course of enrolledCourses) {
            const stateKey = `${this.currentStudentId}-${course.id}`;
            const originalState = this.originalFormStates.get(stateKey);
            const currentState = await this.getCurrentFormState(this.currentStudentId, course.id);

            if (!currentState) continue;

            // Check if there are changes or new data
            if (!originalState || this.hasFormStateChanged(originalState, currentState) || this.hasAnyData(currentState)) {
                await this.saveRecordForCourse(this.currentStudentId, course.id, true); // Suppress individual alerts
                savedCount++;
            }
        }

        if (savedCount > 0) {
            // Show brief success message
            const message = savedCount === 1 
                ? '1 course record saved successfully!'
                : `${savedCount} course records saved successfully!`;
            alert(message);
        }
    }

    async saveRecord() {
        const studentId = parseInt(document.getElementById('record-student').value);
        const courseId = parseInt(document.getElementById('record-course').value);

        if (!studentId || !courseId) {
            alert('Please select both a student and a course');
            return;
        }

        const course = await this.get('courses', courseId);
        const isTermComment = this.isTermCommentCourse(course.name);
        
        let competencies = [];
        let behaviours = {};

        if (isTermComment) {
            // For Term Comment courses, behaviours are stored in competencies array
            competencies = Array.from(document.querySelectorAll('.behaviour-level')).map(select => select.value);
        } else {
            // For regular courses, competencies go in competencies array
            competencies = Array.from(document.querySelectorAll('.competency-level')).map(select => select.value);
            // Behaviours are not used for regular courses anymore
        }

        const record = {
            studentId,
            courseId,
            competencies,
            behaviours: isTermComment ? {} : behaviours, // Empty for Term Comment courses
            unitsComplete: course.units > 0 ? (parseInt(document.getElementById('units-complete')?.value) || 0) : 0,
            stockComment1: parseInt(document.getElementById('stock-comment-1').value) || null,
            stockComment2: parseInt(document.getElementById('stock-comment-2').value) || null,
            comments: document.getElementById('custom-comment').value.trim(),
            termGrade: document.getElementById('term-grade').value.trim(),
            dateCompleted: document.getElementById('date-completed').value || null,
            date: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Check if record already exists
        const records = await this.getAll('records');
        const existing = records.find(r => r.studentId === studentId && r.courseId === courseId);

        // Check if a completion date was entered
        const hasCompletionDate = record.dateCompleted && record.dateCompleted.trim() !== '';
        
        if (existing) {
            record.id = existing.id;
            await this.update('records', record);
            alert('Record updated successfully!');
        } else {
            await this.add('records', record);
            alert('Record saved successfully!');
        }
        
        // Celebrate if a completion date was entered!
        if (hasCompletionDate) {
            this.showUnicornCelebration();
        }

        // Reset form
        document.getElementById('competency-form').innerHTML = '';
        document.getElementById('record-student').value = '';
        document.getElementById('record-course').value = '';
    }

    async copyToAspen() {
        const studentId = parseInt(document.getElementById('record-student').value);
        const courseId = parseInt(document.getElementById('record-course').value);

        if (!studentId || !courseId) {
            alert('Please select both a student and a course');
            return;
        }

        const course = await this.get('courses', courseId);
        const student = await this.get('students', studentId);
        const stockComments = await this.getAll('stockComments');
        const isTermComment = this.isTermCommentCourse(course.name);

        let output = '';

        if (isTermComment) {
            // Format for Term Comment courses
            output = 'Behaviours for Success - In demonstrating academic responsibility, the student:\n';
            
            // Get behaviour levels
            const behaviourSelects = document.querySelectorAll('.behaviour-level');
            course.competencies.forEach((behaviour, index) => {
                const select = behaviourSelects[index];
                const level = select ? select.value : '';
                let levelText = '';
                if (level === 'R') levelText = 'RARELY';
                else if (level === 'S') levelText = 'SOMETIMES';
                else if (level === 'C') levelText = 'CONSISTENTLY';
                
                if (levelText) {
                    output += `${behaviour}: ${levelText}\n`;
                } else {
                    output += `${behaviour}:\n`;
                }
            });
            
            // Add comments
            const commentParts = [];
            
            const stockComment1Id = parseInt(document.getElementById('stock-comment-1').value);
            const stockComment2Id = parseInt(document.getElementById('stock-comment-2').value);
            const customComment = document.getElementById('custom-comment').value.trim();
            
            if (stockComment1Id) {
                const sc1 = stockComments.find(sc => sc.id === stockComment1Id);
                if (sc1) commentParts.push(sc1.text);
            }
            if (stockComment2Id) {
                const sc2 = stockComments.find(sc => sc.id === stockComment2Id);
                if (sc2) commentParts.push(sc2.text);
            }
            if (customComment) {
                commentParts.push(customComment);
            }
            
            if (commentParts.length > 0) {
                output += '\nComments: ';
                output += commentParts.join(' ');
            }
            
        } else {
            // Format for regular courses
            output = 'Curricular Competencies - In terms of student learning:\n';
            
            // Get competency levels
            const competencySelects = document.querySelectorAll('.competency-level');
            course.competencies.forEach((competency, index) => {
                const select = competencySelects[index];
                const level = select ? select.value : '';
                let levelText = '';
                if (level === 'E') levelText = 'EMERGING';
                else if (level === 'D') levelText = 'DEVELOPING';
                else if (level === 'P') levelText = 'PROFICIENT';
                else if (level === 'X') levelText = 'EXTENDING';
                else if (level === '0') levelText = 'NO EVIDENCE';
                
                if (levelText) {
                    output += `${index + 1}. ${competency}: ${levelText}\n`;
                } else {
                    output += `${index + 1}. ${competency}:\n`;
                }
            });
            
            // Add units complete
            const unitsComplete = course.units > 0 
                ? (parseInt(document.getElementById('units-complete')?.value) || 0)
                : 0;
            if (course.units > 0) {
                output += `\nUnits Complete:\n${unitsComplete}/${course.units}\n`;
            }
            
            // Add comments
            const commentParts = [];
            
            const stockComment1Id = parseInt(document.getElementById('stock-comment-1').value);
            const stockComment2Id = parseInt(document.getElementById('stock-comment-2').value);
            const customComment = document.getElementById('custom-comment').value.trim();
            
            if (stockComment1Id) {
                const sc1 = stockComments.find(sc => sc.id === stockComment1Id);
                if (sc1) commentParts.push(sc1.text);
            }
            if (stockComment2Id) {
                const sc2 = stockComments.find(sc => sc.id === stockComment2Id);
                if (sc2) commentParts.push(sc2.text);
            }
            if (customComment) {
                commentParts.push(customComment);
            }
            
            if (commentParts.length > 0) {
                output += '\nComments:\n';
                output += commentParts.join(' ');
            }
        }

        // Copy to clipboard
        try {
            await navigator.clipboard.writeText(output);
            alert('Copied to clipboard! You can now paste into Aspen.');
        } catch (err) {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = output;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                alert('Copied to clipboard! You can now paste into Aspen.');
            } catch (e) {
                alert('Could not copy to clipboard. Please copy manually:\n\n' + output);
            }
            document.body.removeChild(textArea);
        }
    }

    // Reports
    async populateReportDropdowns() {
        const students = await this.getAll('students');
        const courses = await this.getAll('courses');
        
        const courseSelect = document.getElementById('report-course');
        const studentSelect = document.getElementById('report-student');
        const attendanceStudentSelect = document.getElementById('attendance-report-student');
        
        // Populate course dropdown
        courseSelect.innerHTML = '<option value="">Select a course</option>';
        courses.forEach(course => {
            const option = document.createElement('option');
            option.value = course.id;
            option.textContent = `${course.name} (Grade ${course.grade})`;
            courseSelect.appendChild(option);
        });
        
        // Student dropdown: always show All Students + all students (not filtered by course)
        studentSelect.innerHTML = '<option value=\"\">All Students</option>';
        const sortedAllStudents = [...students].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        sortedAllStudents.forEach(student => {
            const option = document.createElement('option');
            option.value = student.id;
            option.textContent = student.name;
            studentSelect.appendChild(option);
        });
        
        // Attendance report student dropdown
        if (attendanceStudentSelect) {
            attendanceStudentSelect.innerHTML = '<option value=\"\">All Students</option>';
            sortedAllStudents.forEach(student => {
                const option = document.createElement('option');
                option.value = student.id;
                option.textContent = student.name;
                attendanceStudentSelect.appendChild(option);
            });
        }
    }

    showUnicornCelebration() {
        const unicorn = document.getElementById('unicorn-celebration');
        if (!unicorn) return;
        
        unicorn.style.display = 'block';
        
        // Hide after animation completes
        setTimeout(() => {
            unicorn.style.display = 'none';
        }, 3000);
    }

    showGraduationCelebration() {
        // Create fireworks container if it doesn't exist
        let fireworksContainer = document.getElementById('fireworks-container');
        if (!fireworksContainer) {
            fireworksContainer = document.createElement('div');
            fireworksContainer.id = 'fireworks-container';
            fireworksContainer.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10001;';
            document.body.appendChild(fireworksContainer);
        }

        // Show unicorn celebration
        const unicorn = document.getElementById('unicorn-celebration');
        if (unicorn) {
            unicorn.style.display = 'block';
            unicorn.innerHTML = `
                <div id="unicorn-emoji" style="font-size: 120px; text-align: center;">
                    🦄
                </div>
                <div style="text-align: center; margin-top: 20px; font-size: 24px; font-weight: bold; color: #fbbf24; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);">
                    🎉 Congratulations! 🎉
                </div>
            `;
        }

        // Create fireworks
        this.createFireworks(fireworksContainer);

        // Hide after animation completes
        setTimeout(() => {
            if (unicorn) unicorn.style.display = 'none';
            if (fireworksContainer) {
                fireworksContainer.innerHTML = '';
            }
        }, 4000);
    }

    createFireworks(container) {
        const colors = ['#fbbf24', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#3b82f6', '#10b981'];
        const particleCount = 50;

        for (let i = 0; i < 8; i++) {
            setTimeout(() => {
                const x = Math.random() * window.innerWidth;
                const y = Math.random() * window.innerHeight * 0.6; // Upper 60% of screen
                
                for (let j = 0; j < particleCount; j++) {
                    const particle = document.createElement('div');
                    const angle = (Math.PI * 2 * j) / particleCount;
                    const velocity = 2 + Math.random() * 3;
                    const color = colors[Math.floor(Math.random() * colors.length)];
                    
                    particle.style.cssText = `
                        position: absolute;
                        left: ${x}px;
                        top: ${y}px;
                        width: 6px;
                        height: 6px;
                        background: ${color};
                        border-radius: 50%;
                        pointer-events: none;
                        box-shadow: 0 0 10px ${color};
                    `;
                    
                    container.appendChild(particle);
                    
                    const vx = Math.cos(angle) * velocity;
                    const vy = Math.sin(angle) * velocity;
                    
                    let px = x;
                    let py = y;
                    let opacity = 1;
                    
                    const animate = () => {
                        px += vx;
                        py += vy;
                        opacity -= 0.02;
                        vy += 0.1; // Gravity
                        
                        particle.style.left = px + 'px';
                        particle.style.top = py + 'px';
                        particle.style.opacity = opacity;
                        
                        if (opacity > 0 && py < window.innerHeight) {
                            requestAnimationFrame(animate);
                        } else {
                            particle.remove();
                        }
                    };
                    
                    requestAnimationFrame(animate);
                }
            }, i * 200);
        }
    }

    // Helper function to find which competency indices have been assessed
    getAssessedCompetencyIndices(records) {
        const assessedIndices = new Set();
        
        for (const record of records) {
            if (record.competencies && Array.isArray(record.competencies)) {
                record.competencies.forEach((level, index) => {
                    // Consider a competency assessed if it has a non-empty value
                    if (level && level.trim() !== '') {
                        assessedIndices.add(index);
                    }
                });
            }
        }
        
        return Array.from(assessedIndices).sort((a, b) => a - b);
    }

    async generateReport() {
        const courseId = parseInt(document.getElementById('report-course').value);
        const studentId = this.getSelectedReportStudentId();

        if (!courseId) {
            alert('Please select a course');
            return;
        }

        // Hide Aspen output, show regular report
        document.getElementById('aspen-output').style.display = 'none';
        document.getElementById('report-output').style.display = 'block';

        const course = await this.get('courses', courseId);
        const isTermComment = this.isTermCommentCourse(course.name);
        const records = await this.getAll('records');
        const allStudents = await this.getAll('students');
        const stockComments = await this.getAll('stockComments');
        
        // If "All Students" is selected (no specific ID), show all enrolled students (even if they don't have records yet)
        let filteredRecords = records.filter(r => r.courseId === courseId);
        
        if (studentId) {
            // Filter to specific student
            filteredRecords = filteredRecords.filter(r => r.studentId === studentId);
        } else {
            // "All Students" selected - include all enrolled students, even without records
            const enrolledStudentIds = course.studentIds || [];
            const studentsWithRecords = new Set(filteredRecords.map(r => r.studentId));
            
            // Create placeholder records for enrolled students without records
            for (const enrolledStudentId of enrolledStudentIds) {
                if (!studentsWithRecords.has(enrolledStudentId)) {
                    // Create a minimal record structure for students without data
                    filteredRecords.push({
                        studentId: enrolledStudentId,
                        courseId: courseId,
                        competencies: new Array(course.competencies.length).fill(''),
                        behaviours: {},
                        unitsComplete: 0,
                        stockComment1: null,
                        stockComment2: null,
                        comments: '',
                        termGrade: '',
                        dateCompleted: null
                    });
                }
            }
        }
        
        // Sort by student name
        filteredRecords.sort((a, b) => {
            const studentA = allStudents.find(s => s.id === a.studentId);
            const studentB = allStudents.find(s => s.id === b.studentId);
            const nameA = studentA ? studentA.name : '';
            const nameB = studentB ? studentB.name : '';
            return nameA.localeCompare(nameB);
        });

        // Find which competencies have been assessed
        const assessedIndices = this.getAssessedCompetencyIndices(filteredRecords);
        
        // Determine column headers based on course type - only for assessed competencies
        const competencyHeaders = assessedIndices.length > 0
            ? assessedIndices.map(index => 
                isTermComment 
                    ? `<th>Behaviour ${index + 1}</th>`
                    : `<th>CC${index + 1}</th>`
              ).join('')
            : '';

        let html = `
            <h3>Report: ${this.escapeHtml(course.name)}</h3>
            <table class="report-table">
                <thead>
                    <tr>
                        <th>Student</th>
                        <th>IEP/SSP</th>
                        ${competencyHeaders}
                        ${course.units > 0 ? '<th>Units</th>' : ''}
                        ${course.units > 0 ? '<th>Date Completed</th>' : ''}
                        <th>Stock Comment 1</th>
                        <th>Stock Comment 2</th>
                        <th>Comments</th>
                        <th>Grade</th>
                    </tr>
                </thead>
                <tbody>
        `;

        for (const record of filteredRecords) {
            const student = allStudents.find(s => s.id === record.studentId);
            if (!student) continue;

            const sc1 = record.stockComment1 ? stockComments.find(sc => sc.id === record.stockComment1) : null;
            const sc2 = record.stockComment2 ? stockComments.find(sc => sc.id === record.stockComment2) : null;

            const unitsCell = course.units > 0 
                ? `<td>${record.unitsComplete || 0}/${course.units}</td>`
                : '';
            
            // Date Completed cell - only show if date exists and course has units
            const dateCompletedCell = course.units > 0 && record.dateCompleted
                ? `<td>${this.formatDate(record.dateCompleted)}</td>`
                : course.units > 0 ? '<td>-</td>' : '';

            // Only include assessed competencies in the row
            const competencyCells = assessedIndices.length > 0
                ? assessedIndices.map(index => {
                    const level = record.competencies && record.competencies[index] ? record.competencies[index] : '';
                    return `<td>${level || '-'}</td>`;
                }).join('')
                : '';

            html += `
                <tr>
                    <td>${this.escapeHtml(student.name)}</td>
                    <td>${student.iep || ''}</td>
                    ${competencyCells}
                    ${unitsCell}
                    ${dateCompletedCell}
                    <td>${sc1 ? this.escapeHtml(sc1.text) : '-'}</td>
                    <td>${sc2 ? this.escapeHtml(sc2.text) : '-'}</td>
                    <td>${this.escapeHtml(record.comments || '-')}</td>
                    <td>${this.escapeHtml(record.termGrade || '-')}</td>
                </tr>
            `;
        }

        html += `
                </tbody>
            </table>
        `;

        document.getElementById('report-output').innerHTML = html;
    }

    async exportToCSV() {
        const courseId = parseInt(document.getElementById('report-course').value);
        if (!courseId) {
            alert('Please select a course first');
            return;
        }

        const course = await this.get('courses', courseId);
        const studentId = this.getSelectedReportStudentId();
        const isTermComment = this.isTermCommentCourse(course.name);
        const records = await this.getAll('records');
        const allStudents = await this.getAll('students');
        const stockComments = await this.getAll('stockComments');
        
        // Filter records based on student selection
        let filteredRecords = records.filter(r => r.courseId === courseId);
        
        if (studentId) {
            // Filter to specific student
            filteredRecords = filteredRecords.filter(r => r.studentId === studentId);
        } else {
            // "All Students" selected - include all enrolled students, even without records
            const enrolledStudentIds = course.studentIds || [];
            const studentsWithRecords = new Set(filteredRecords.map(r => r.studentId));
            
            // Create placeholder records for enrolled students without records
            for (const enrolledStudentId of enrolledStudentIds) {
                if (!studentsWithRecords.has(enrolledStudentId)) {
                    filteredRecords.push({
                        studentId: enrolledStudentId,
                        courseId: courseId,
                        competencies: new Array(course.competencies.length).fill(''),
                        behaviours: {},
                        unitsComplete: 0,
                        stockComment1: null,
                        stockComment2: null,
                        comments: '',
                        termGrade: '',
                        dateCompleted: null
                    });
                }
            }
        }
        
        // Sort by student name
        filteredRecords.sort((a, b) => {
            const studentA = allStudents.find(s => s.id === a.studentId);
            const studentB = allStudents.find(s => s.id === b.studentId);
            const nameA = studentA ? studentA.name : '';
            const nameB = studentB ? studentB.name : '';
            return nameA.localeCompare(nameB);
        });

        // Find which competencies have been assessed
        const assessedIndices = this.getAssessedCompetencyIndices(filteredRecords);
        
        // Build CSV header based on course type - only for assessed competencies
        const competencyHeaders = assessedIndices.length > 0
            ? assessedIndices.map(index => 
                isTermComment ? `Behaviour ${index + 1}` : `CC${index + 1}`
              ).join(',')
            : '';
        
        const unitsHeader = course.units > 0 ? 'Units Complete,' : '';
        const dateHeader = course.units > 0 ? 'Date Completed,' : '';
        // Build header: always have Student Name and IEP/SSP, then competencies (if any), then units/date/comments
        let csv = `Student Name,IEP/SSP`;
        if (competencyHeaders) {
            csv += `,${competencyHeaders}`;
        }
        csv += `,${unitsHeader}${dateHeader}Stock Comment 1,Stock Comment 2,Comments,Grade\n`;

        for (const record of filteredRecords) {
            const student = allStudents.find(s => s.id === record.studentId);
            if (!student) continue;

            const sc1 = record.stockComment1 ? stockComments.find(sc => sc.id === record.stockComment1) : null;
            const sc2 = record.stockComment2 ? stockComments.find(sc => sc.id === record.stockComment2) : null;

            // Only include assessed competencies
            const competencyValues = assessedIndices.length > 0
                ? assessedIndices.map(index => {
                    const level = record.competencies && record.competencies[index] ? record.competencies[index] : '';
                    return level || '';
                })
                : [];

            const row = [
                student.name,
                student.iep || '',
                ...competencyValues,
            ];
            
            if (course.units > 0) {
                row.push(record.unitsComplete || 0);
                row.push(record.dateCompleted ? this.formatDate(record.dateCompleted) : '');
            }
            
            row.push(
                sc1 ? sc1.text.replace(/,/g, ';') : '',
                sc2 ? sc2.text.replace(/,/g, ';') : '',
                (record.comments || '').replace(/,/g, ';'),
                record.termGrade || ''
            );

            csv += row.map(cell => `"${cell}"`).join(',') + '\n';
        }

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${course.name.replace(/\s+/g, '_')}_report_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    }

    formatRecordForAspen(course, record, stockComments) {
        const isTermComment = this.isTermCommentCourse(course.name);
        let output = '';

        // Find which competencies have been assessed for this record
        const assessedCompetencies = [];
        if (record.competencies && Array.isArray(record.competencies)) {
            course.competencies.forEach((competency, index) => {
                const level = record.competencies[index] || '';
                if (level && level.trim() !== '') {
                    assessedCompetencies.push({ index, competency, level });
                }
            });
        }

        if (isTermComment) {
            // Format for Term Comment courses - only if there are assessed behaviours
            if (assessedCompetencies.length > 0) {
                output = 'Behaviours for Success - In demonstrating academic responsibility, the student:\n';
                
                // Get behaviour levels - only for assessed ones
                assessedCompetencies.forEach(({ competency, level }) => {
                    let levelText = '';
                    if (level === 'R') levelText = 'RARELY';
                    else if (level === 'S') levelText = 'SOMETIMES';
                    else if (level === 'C') levelText = 'CONSISTENTLY';
                    
                    if (levelText) {
                        output += `${competency}: ${levelText}\n`;
                    }
                });
            }
            
            // Add comments
            const commentParts = [];
            
            if (record.stockComment1) {
                const sc1 = stockComments.find(sc => sc.id === record.stockComment1);
                if (sc1) commentParts.push(sc1.text);
            }
            if (record.stockComment2) {
                const sc2 = stockComments.find(sc => sc.id === record.stockComment2);
                if (sc2) commentParts.push(sc2.text);
            }
            if (record.comments) {
                commentParts.push(record.comments);
            }
            
            if (commentParts.length > 0) {
                if (assessedCompetencies.length > 0) {
                    output += '\nComments: ';
                } else {
                    output = 'Comments: ';
                }
                output += commentParts.join(' ');
            }
            
        } else {
            // Format for regular courses - only if there are assessed competencies
            if (assessedCompetencies.length > 0) {
                output = 'Curricular Competencies - In terms of student learning:\n';
                
                // Get competency levels - only for assessed ones
                // Need to maintain original numbering based on position in course.competencies
                assessedCompetencies.forEach(({ index, competency, level }) => {
                    let levelText = '';
                    if (level === 'E') levelText = 'EMERGING';
                    else if (level === 'D') levelText = 'DEVELOPING';
                    else if (level === 'P') levelText = 'PROFICIENT';
                    else if (level === 'X') levelText = 'EXTENDING';
                    else if (level === '0') levelText = 'NO EVIDENCE';
                    
                    if (levelText) {
                        output += `${index + 1}. ${competency}: ${levelText}\n`;
                    }
                });
            }
            
            // Add units complete
            if (course.units > 0) {
                const unitsComplete = record.unitsComplete || 0;
                if (assessedCompetencies.length > 0) {
                    output += `\nUnits Complete:\n${unitsComplete}/${course.units}\n`;
                } else {
                    output = `Units Complete:\n${unitsComplete}/${course.units}\n`;
                }
            }
            
            // Add comments
            const commentParts = [];
            
            if (record.stockComment1) {
                const sc1 = stockComments.find(sc => sc.id === record.stockComment1);
                if (sc1) commentParts.push(sc1.text);
            }
            if (record.stockComment2) {
                const sc2 = stockComments.find(sc => sc.id === record.stockComment2);
                if (sc2) commentParts.push(sc2.text);
            }
            if (record.comments) {
                commentParts.push(record.comments);
            }
            
            if (commentParts.length > 0) {
                if (assessedCompetencies.length > 0 || (course.units > 0 && (record.unitsComplete || 0) > 0)) {
                    output += '\nComments:\n';
                } else {
                    output = 'Comments:\n';
                }
                output += commentParts.join(' ');
            }
        }

        return output;
    }

    async generateAspenFormat() {
        const courseId = parseInt(document.getElementById('report-course').value);
        const studentId = this.getSelectedReportStudentId();

        if (!courseId) {
            alert('Please select a course');
            return;
        }

        const course = await this.get('courses', courseId);
        const records = await this.getAll('records');
        const allStudents = await this.getAll('students');
        const stockComments = await this.getAll('stockComments');
        
        // Filter records based on student selection
        let filteredRecords = records.filter(r => r.courseId === courseId);
        
        if (studentId) {
            // Filter to specific student
            filteredRecords = filteredRecords.filter(r => r.studentId === studentId);
        } else {
            // "All Students" selected - include all enrolled students, even without records
            const enrolledStudentIds = course.studentIds || [];
            const studentsWithRecords = new Set(filteredRecords.map(r => r.studentId));
            
            // Create placeholder records for enrolled students without records
            for (const enrolledStudentId of enrolledStudentIds) {
                if (!studentsWithRecords.has(enrolledStudentId)) {
                    filteredRecords.push({
                        studentId: enrolledStudentId,
                        courseId: courseId,
                        competencies: new Array(course.competencies.length).fill(''),
                        behaviours: {},
                        unitsComplete: 0,
                        stockComment1: null,
                        stockComment2: null,
                        comments: '',
                        termGrade: '',
                        dateCompleted: null
                    });
                }
            }
        }
        
        // Sort by student name
        filteredRecords.sort((a, b) => {
            const studentA = allStudents.find(s => s.id === a.studentId);
            const studentB = allStudents.find(s => s.id === b.studentId);
            const nameA = studentA ? studentA.name : '';
            const nameB = studentB ? studentB.name : '';
            return nameA.localeCompare(nameB);
        });

        // Hide regular report, show Aspen output
        document.getElementById('report-output').style.display = 'none';
        const aspenOutput = document.getElementById('aspen-output');
        aspenOutput.style.display = 'block';

        if (filteredRecords.length === 0) {
            aspenOutput.innerHTML = '<p style="text-align: center; color: var(--secondary-color); padding: 40px;">No records found for this course. Please record competencies for students first.</p>';
            return;
        }

        let html = `
            <div style="background: var(--card-bg); padding: 25px; border-radius: 8px; box-shadow: var(--shadow); margin-top: 20px;">
                <h3 style="margin-bottom: 20px;">Aspen Format for: ${this.escapeHtml(course.name)}</h3>
                <p style="margin-bottom: 20px; color: var(--secondary-color);">Click "Copy" next to each student to copy their formatted text to clipboard.</p>
        `;

        // Sort students alphabetically
        const studentRecords = filteredRecords.map(record => {
            const student = allStudents.find(s => s.id === record.studentId);
            return { student, record };
        }).filter(sr => sr.student);

        studentRecords.forEach(({ student, record }, index) => {
            const formattedText = this.formatRecordForAspen(course, record, stockComments);
            const textId = `aspen-text-${index}`;
            
            html += `
                <div style="margin-bottom: 30px; padding: 20px; background: var(--bg-color); border-radius: 8px; border-left: 4px solid var(--primary-color);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                        <h4 style="margin: 0;">${this.escapeHtml(student.name)}</h4>
                        <button class="btn btn-primary" onclick="tracker.copyAspenText('${textId}')" style="min-width: 100px;" data-text-id="${textId}">Copy</button>
                    </div>
                    <textarea id="${textId}" readonly style="width: 100%; min-height: 150px; padding: 12px; border: 1px solid var(--border-color); border-radius: 6px; font-family: monospace; font-size: 0.9rem; background: white; resize: vertical;" onclick="this.select()">${this.escapeHtml(formattedText)}</textarea>
                </div>
            `;
        });

        html += `</div>`;
        aspenOutput.innerHTML = html;
    }

    formatLongDate(date = new Date()) {
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    }

    getSelectedReportStudentId() {
        const select = document.getElementById('report-student');
        if (!select) return null;
        const value = select.value;
        if (!value) return null; // All Students
        const id = parseInt(value);
        return isNaN(id) ? null : id;
    }

    async generateAttendanceReport() {
        const startDateInput = document.getElementById('attendance-report-start-date');
        const endDateInput = document.getElementById('attendance-report-end-date');
        const studentSelect = document.getElementById('attendance-report-student');
        
        if (!startDateInput || !endDateInput || !startDateInput.value || !endDateInput.value) {
            alert('Please select both start and end dates.');
            return;
        }
        
        const startDate = startDateInput.value;
        const endDate = endDateInput.value;
        
        if (startDate > endDate) {
            alert('Start date must be before or equal to end date.');
            return;
        }
        
        const selectedStudentId = studentSelect.value ? parseInt(studentSelect.value) : null;
        
        // Get all data
        const students = await this.getAll('students');
        const attendanceRecords = await this.getAll('attendance');
        const nonInstructionalDays = await this.getAll('nonInstructionalDays');
        const nonInstructionalSet = new Set(nonInstructionalDays.map(d => d.date));
        
        // Filter students if specific student selected
        let reportStudents = students;
        if (selectedStudentId) {
            reportStudents = students.filter(s => s.id === selectedStudentId);
        }
        
        // Sort students by name
        reportStudents.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        
        // Filter attendance records by date range
        const filteredRecords = attendanceRecords.filter(record => {
            return record.date >= startDate && record.date <= endDate;
        });
        
        // Create a map of student attendance by date
        const studentAttendanceMap = new Map();
        filteredRecords.forEach(record => {
            if (!studentAttendanceMap.has(record.studentId)) {
                studentAttendanceMap.set(record.studentId, new Map());
            }
            studentAttendanceMap.get(record.studentId).set(record.date, record.status);
        });
        
        // Generate date range (timezone-aware)
        const dates = [];
        const startParts = startDate.split('-');
        const endParts = endDate.split('-');
        const start = new Date(parseInt(startParts[0]), parseInt(startParts[1]) - 1, parseInt(startParts[2]));
        const end = new Date(parseInt(endParts[0]), parseInt(endParts[1]) - 1, parseInt(endParts[2]));
        
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            dates.push(dateStr);
        }
        
        // Calculate statistics for each student
        const studentStats = [];
        
        // Get all holidays for the date range
        const holidaysSet = new Set();
        const startYear = new Date(startDate).getFullYear();
        const endYear = new Date(endDate).getFullYear();
        for (let year = startYear; year <= endYear; year++) {
            const holidays = this.getYukonHolidays(year);
            holidays.forEach(h => holidaysSet.add(h));
        }
        
        for (const student of reportStudents) {
            const attendanceMap = studentAttendanceMap.get(student.id) || new Map();
            let present = 0;
            let absent = 0;
            let notRecorded = 0;
            let instructionalDays = 0;
            
            for (const dateStr of dates) {
                const isWeekendDay = this.isWeekend(dateStr);
                const isHoliday = holidaysSet.has(dateStr);
                const isNonInstructional = nonInstructionalSet.has(dateStr);
                const isNonInstructionalDay = isNonInstructional || isWeekendDay || isHoliday;
                
                if (!isNonInstructionalDay) {
                    instructionalDays++;
                    const status = attendanceMap.get(dateStr);
                    if (status === 'present') {
                        present++;
                    } else if (status === 'absent') {
                        absent++;
                    } else {
                        notRecorded++;
                    }
                }
            }
            
            const attendanceRate = instructionalDays > 0 ? ((present / instructionalDays) * 100).toFixed(1) : '0.0';
            
            studentStats.push({
                student,
                present,
                absent,
                notRecorded,
                instructionalDays,
                attendanceRate,
                attendanceMap
            });
        }
        
        // Generate HTML report
        let html = '<div class="attendance-report-container">';
        html += `<h3>Attendance Report: ${this.formatDateForDisplay(startDate)} to ${this.formatDateForDisplay(endDate)}</h3>`;
        
        if (selectedStudentId) {
            const student = students.find(s => s.id === selectedStudentId);
            if (student) {
                html += `<p><strong>Student:</strong> ${this.escapeHtml(student.name)}</p>`;
            }
        } else {
            html += `<p><strong>All Students</strong></p>`;
        }
        
        // Debug logging
        console.log('Attendance Report Debug:', {
            students: reportStudents.length,
            attendanceRecords: attendanceRecords.length,
            filteredRecords: filteredRecords.length,
            dateRange: { startDate, endDate },
            dates: dates.length,
            studentStats: studentStats.length,
            nonInstructionalDays: nonInstructionalDays.length
        });
        
        if (reportStudents.length === 0) {
            html += '<p class="empty-state">No students found. Please add students in the Students tab first.</p>';
            html += '</div>';
            
            const output = document.getElementById('attendance-report-output');
            if (output) {
                output.innerHTML = html;
                output.style.display = 'block';
            }
            return;
        }
        
        // Summary statistics
        const totalPresent = studentStats.reduce((sum, stat) => sum + stat.present, 0);
        const totalAbsent = studentStats.reduce((sum, stat) => sum + stat.absent, 0);
        const totalNotRecorded = studentStats.reduce((sum, stat) => sum + stat.notRecorded, 0);
        const totalInstructionalDays = studentStats.length > 0 ? studentStats[0].instructionalDays : 0;
        const overallRate = totalInstructionalDays > 0 ? ((totalPresent / (totalPresent + totalAbsent + totalNotRecorded)) * 100).toFixed(1) : '0.0';
        
        html += '<div class="attendance-summary">';
        html += `<p><strong>Total Instructional Days:</strong> ${totalInstructionalDays}</p>`;
        html += `<p><strong>Total Present:</strong> ${totalPresent} | <strong>Total Absent:</strong> ${totalAbsent} | <strong>Not Recorded:</strong> ${totalNotRecorded}</p>`;
        html += '</div>';
        
        // Detailed table for each student
        html += '<table class="attendance-report-table">';
        html += '<thead><tr>';
        html += '<th>Student</th>';
        html += '<th>Present</th>';
        html += '<th>Absent</th>';
        html += '<th>Not Recorded</th>';
        html += '<th>Attendance Rate</th>';
        html += '<th>Details</th>';
        html += '</tr></thead>';
        html += '<tbody>';
        
        if (studentStats.length === 0) {
            html += '<tr><td colspan="6" style="text-align: center; padding: 20px;">No attendance data found for the selected date range.</td></tr>';
        } else {
            studentStats.forEach(stat => {
            html += '<tr>';
            html += `<td>${this.escapeHtml(stat.student.name)}</td>`;
            html += `<td>${stat.present}</td>`;
            html += `<td>${stat.absent}</td>`;
            html += `<td>${stat.notRecorded}</td>`;
            html += `<td>${stat.attendanceRate}%</td>`;
            html += '<td><button class="btn btn-secondary btn-sm" onclick="tracker.showAttendanceDetails(' + stat.student.id + ', \'' + startDate + '\', \'' + endDate + '\')">View Details</button></td>';
            html += '</tr>';
            });
        }
        
        html += '</tbody></table>';
        html += '</div>';
        
        // Display report
        const output = document.getElementById('attendance-report-output');
        if (output) {
            output.innerHTML = html;
            output.style.display = 'block';
        }
        
        // Hide other report outputs
        document.getElementById('report-output').style.display = 'none';
        document.getElementById('aspen-output').style.display = 'none';
        document.getElementById('report-card-output').style.display = 'none';
    }

    async showAttendanceDetails(studentId, startDate, endDate) {
        const student = await this.get('students', studentId);
        if (!student) return;
        
        const attendanceRecords = await this.getAll('attendance');
        const nonInstructionalDays = await this.getAll('nonInstructionalDays');
        const nonInstructionalSet = new Set(nonInstructionalDays.map(d => d.date));
        
        // Filter attendance records for this student and date range
        const studentRecords = attendanceRecords.filter(r => 
            r.studentId === studentId && r.date >= startDate && r.date <= endDate
        );
        
        const attendanceMap = new Map();
        studentRecords.forEach(record => {
            attendanceMap.set(record.date, record.status);
        });
        
        // Generate date range
        const dates = [];
        const start = new Date(startDate);
        const end = new Date(endDate);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            dates.push(dateStr);
        }
        
        // Create modal with detailed attendance
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'attendance-details-modal';
        modal.style.display = 'block';
        
        let html = '<div class="modal-content" style="max-width: 800px; max-height: 90vh; overflow-y: auto;">';
        html += '<span class="close" onclick="document.getElementById(\'attendance-details-modal\').remove()">&times;</span>';
        html += `<h2>Attendance Details: ${this.escapeHtml(student.name)}</h2>`;
        html += `<p><strong>Date Range:</strong> ${this.formatDateForDisplay(startDate)} to ${this.formatDateForDisplay(endDate)}</p>`;
        
        html += '<table class="attendance-details-table">';
        html += '<thead><tr><th>Date</th><th>Day</th><th>Status</th><th>Type</th></tr></thead>';
        html += '<tbody>';
        
        // Get all holidays for the date range
        const holidaysSet = new Set();
        const startYear = new Date(startDate).getFullYear();
        const endYear = new Date(endDate).getFullYear();
        for (let year = startYear; year <= endYear; year++) {
            const holidays = this.getYukonHolidays(year);
            holidays.forEach(h => holidaysSet.add(h));
        }
        
        dates.forEach(dateStr => {
            // Parse date string to avoid timezone issues
            const parts = dateStr.split('-');
            const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
            const isWeekendDay = this.isWeekend(dateStr);
            const isHoliday = holidaysSet.has(dateStr);
            const isNonInstructional = nonInstructionalSet.has(dateStr) || isWeekendDay || isHoliday;
            const status = attendanceMap.get(dateStr);
            
            let statusText = 'Not Recorded';
            let statusClass = 'not-recorded';
            if (isNonInstructional) {
                statusText = 'Non-Instructional';
                statusClass = 'non-instructional';
            } else if (status === 'present') {
                statusText = 'Present';
                statusClass = 'present';
            } else if (status === 'absent') {
                statusText = 'Absent';
                statusClass = 'absent';
            }
            
            html += '<tr class="' + statusClass + '">';
            html += `<td>${this.formatDateForDisplay(dateStr)}</td>`;
            html += `<td>${dayName}</td>`;
            html += `<td>${statusText}</td>`;
            html += `<td>${isNonInstructional ? 'Non-Instructional' : 'Instructional'}</td>`;
            html += '</tr>';
        });
        
        html += '</tbody></table>';
        html += '</div>';
        
        modal.innerHTML = html;
        document.body.appendChild(modal);
        
        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    async generateReportCard() {
        const studentId = this.getSelectedReportStudentId();
        const allStudents = await this.getAll('students');
        const courses = await this.getAll('courses');
        const records = await this.getAll('records');
        const stockComments = await this.getAll('stockComments');

        // Hide other outputs
        document.getElementById('aspen-output').style.display = 'none';
        document.getElementById('report-output').style.display = 'none';
        const reportCardOutput = document.getElementById('report-card-output');
        reportCardOutput.style.display = 'block';

        const printBtn = document.getElementById('print-report-card-btn');
        if (printBtn) printBtn.style.display = 'inline-block';

        const studentsToRender = studentId
            ? allStudents.filter(s => s.id === studentId)
            : allStudents.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        if (studentsToRender.length === 0) {
            reportCardOutput.innerHTML = '<p style="text-align:center; color: var(--secondary-color); padding: 40px;">No students found to generate report cards.</p>';
            return;
        }

        const printedDate = this.formatLongDate(new Date());

        const renderTermCommentBlock = (course, record) => {
            // Build behaviour lines ONLY if assessed
            const assessed = [];
            const levels = (record?.competencies && Array.isArray(record.competencies)) ? record.competencies : [];
            course.competencies.forEach((label, idx) => {
                const level = (levels[idx] || '').trim();
                if (!level) return;

                let levelText = level;
                if (level === 'R') levelText = 'RARELY';
                else if (level === 'S') levelText = 'SOMETIMES';
                else if (level === 'C') levelText = 'CONSISTENTLY';

                assessed.push(`${label}: ${levelText}`);
            });

            const commentParts = [];
            if (record?.stockComment1) {
                const sc1 = stockComments.find(sc => sc.id === record.stockComment1);
                if (sc1?.text) commentParts.push(sc1.text);
            }
            if (record?.stockComment2) {
                const sc2 = stockComments.find(sc => sc.id === record.stockComment2);
                if (sc2?.text) commentParts.push(sc2.text);
            }
            if (record?.comments) commentParts.push(record.comments);
            const commentsText = commentParts.join(' ').trim();

            const sectionTitle = 'Behaviours for Success - In demonstrating academic responsibility, the student:';

            // Omit behaviour section if none assessed
            const behaviourSection = assessed.length > 0
                ? `<div class="rc-competencies"><strong>${this.escapeHtml(sectionTitle)}</strong>\n${this.escapeHtml(assessed.join('\n'))}</div>`
                : '';

            const commentsSection = commentsText
                ? `<div class="rc-comments"><strong>Comments:</strong> ${this.escapeHtml(commentsText)}</div>`
                : '';

            return `
                ${behaviourSection}
                ${commentsSection}
            `;
        };

        const renderCourseBlock = (student, course, record) => {
            const isTermComment = this.isTermCommentCourse(course.name);
            const gradeText = (record?.termGrade || '').trim();
            const formattedGrade = gradeText ? this.formatGradeForReport(gradeText) : '';

            // Build competency/behaviour lines ONLY if assessed for this student
            const assessed = [];
            const levels = (record?.competencies && Array.isArray(record.competencies)) ? record.competencies : [];
            course.competencies.forEach((label, idx) => {
                const level = (levels[idx] || '').trim();
                if (!level) return;

                let levelText = level;
                if (isTermComment) {
                    if (level === 'R') levelText = 'RARELY';
                    else if (level === 'S') levelText = 'SOMETIMES';
                    else if (level === 'C') levelText = 'CONSISTENTLY';
                } else {
                    if (level === 'E') levelText = 'EMERGING';
                    else if (level === 'D') levelText = 'DEVELOPING';
                    else if (level === 'P') levelText = 'PROFICIENT';
                    else if (level === 'X') levelText = 'EXTENDING';
                    else if (level === '0') levelText = 'NO EVIDENCE';
                }

                if (isTermComment) assessed.push(`${label}: ${levelText}`);
                else assessed.push(`${idx + 1}. ${label}: ${levelText}`);
            });

            const commentParts = [];
            if (record?.stockComment1) {
                const sc1 = stockComments.find(sc => sc.id === record.stockComment1);
                if (sc1?.text) commentParts.push(sc1.text);
            }
            if (record?.stockComment2) {
                const sc2 = stockComments.find(sc => sc.id === record.stockComment2);
                if (sc2?.text) commentParts.push(sc2.text);
            }
            if (record?.comments) commentParts.push(record.comments);
            const commentsText = commentParts.join(' ').trim();

            const unitsLine = course.units > 0
                ? `${record?.unitsComplete || 0}/${course.units}`
                : null;
            const dateCompletedLine = record?.dateCompleted ? this.formatDate(record.dateCompleted) : null;

            const sectionTitle = isTermComment
                ? 'Behaviours for Success - In demonstrating academic responsibility, the student:'
                : 'Curricular Competencies - In terms of student learning:';

            // Omit competency section if none assessed (per your rule)
            const competencySection = assessed.length > 0
                ? `<div class="rc-competencies"><strong>${this.escapeHtml(sectionTitle)}</strong>\n${this.escapeHtml(assessed.join('\n'))}</div>`
                : '';

            const unitsSection = course.units > 0
                ? `<div class="rc-competencies"><strong>Units Complete:</strong> ${this.escapeHtml(unitsLine)}${dateCompletedLine ? ` <strong>Date Completed:</strong> ${this.escapeHtml(dateCompletedLine)}` : ''}</div>`
                : (dateCompletedLine ? `<div class="rc-competencies"><strong>Date Completed:</strong> ${this.escapeHtml(dateCompletedLine)}</div>` : '');

            const commentsSection = commentsText
                ? `<div class="rc-comments"><strong>Comments:</strong> ${this.escapeHtml(commentsText)}</div>`
                : '';

            return `
                <div class="rc-course">
                    <div class="rc-course-title">
                        <h4>${this.escapeHtml(course.name)}${formattedGrade ? ` <span class="rc-grade-inline">${this.escapeHtml(formattedGrade)}</span>` : ''}</h4>
                    </div>
                    ${competencySection}
                    ${unitsSection}
                    ${commentsSection}
                </div>
            `;
        };

        const renderStudentReport = (student) => {
            // Find courses student is enrolled in, ordered by custom course ordering
            const enrolledCourses = courses
                .filter(c => (c.studentIds || []).includes(student.id))
                .sort((a, b) => {
                    const orderA = this.getCourseOrderIndex(a.name);
                    const orderB = this.getCourseOrderIndex(b.name);
                    if (orderA !== orderB) return orderA - orderB;
                    return (a.name || '').localeCompare(b.name || '');
                });

            // Pull records for this student
            const studentRecords = records.filter(r => r.studentId === student.id);

            // Teacher overall comment: prefer Term Comment course if present
            const termCommentCourses = enrolledCourses.filter(c => this.isTermCommentCourse(c.name));
            const termCommentBlocks = termCommentCourses.map(tc => {
                const rec = studentRecords.find(r => r.courseId === tc.id) || null;
                return renderTermCommentBlock(tc, rec);
            }).join('');

            const otherCourses = enrolledCourses.filter(c => !this.isTermCommentCourse(c.name));
            const courseBlocks = otherCourses.map(c => {
                const rec = studentRecords.find(r => r.courseId === c.id) || null;
                return renderCourseBlock(student, c, rec);
            }).join('');

            return `
                <div class="report-card">
                    <div class="rc-header">
                        <div class="rc-header-left">
                            <div class="rc-logo">
                                <img src="school-logo.png" alt="Individual Learning Centre logo">
                            </div>
                            <div>
                                <div class="rc-school-name">Individual Learning Centre</div>
                                <div class="rc-school-address">
                                    500-4201 4th Ave, Whitehorse, YT Y1A 5A1<br>
                                    Tel: 867-667-8288
                                </div>
                            </div>
                        </div>
                        <div class="rc-meta">
                            <div><strong>Date Printed:</strong> ${this.escapeHtml(printedDate)}</div>
                        </div>
                    </div>
                    
                    <div class="rc-student-info">
                        <h2 class="rc-student-name">${this.escapeHtml(this.formatNameForReport(student.name))}</h2>
                        <div class="rc-student-details">
                            ${student.grade ? `<span class="rc-student-detail">Grade ${this.escapeHtml(String(student.grade))}</span>` : ''}
                            ${student.gradPlan ? `<span class="rc-student-detail">${this.escapeHtml(student.gradPlan)}</span>` : ''}
                        </div>
                    </div>
                    <div class="rc-section">
                        <h3>School Message</h3>
                        <div class="rc-box">
                            <p>
                                The Individual Learning Centre is committed to a model of education that recognizes the unique strengths of each individual learner and collectively aspires to serve, empower, and re-engage students on their path towards high school graduation. We are an alternative school community that offers diverse and cultural programming opportunities in a safe, nurturing, and respectful environment for students aged 16–21 with a variety of backgrounds, abilities and learning styles through self-paced continuous courses. Through positive relationship building, flexibility, and partnerships, the ILC seeks to provide a holistic, equitable educational experience which opens possibilities for each learner to achieve individual success.
                            </p>
                        </div>
                    </div>

                    <div class="rc-section rc-staff-proficiency">
                        <div class="rc-staff-proficiency-container">
                            <div class="rc-staff-box">
                                <h3>ILC Staff</h3>
                                <div class="rc-box">
                                    <div class="rc-staff-list">
                                        <div class="rc-staff-item"><strong>Loretta DeVries</strong> – Administrative Assistant</div>
                                        <div class="rc-staff-item"><strong>Pat Joe</strong> – First Nation Integration Specialist</div>
                                        <div class="rc-staff-item"><strong>Maura Sullivan</strong> – Team Lead</div>
                                        <div class="rc-staff-item"><strong>Marie Beattie</strong> – Teacher</div>
                                        <div class="rc-staff-item"><strong>Jud Deuling</strong> – Teacher</div>
                                        <div class="rc-staff-item"><strong>Liard McMillan</strong> – Teacher</div>
                                        <div class="rc-staff-item"><strong>Rebecca Davis</strong> – Teacher</div>
                                        <div class="rc-staff-item"><strong>Andrew Crist</strong> – Teacher</div>
                                        <div class="rc-staff-item"><strong>Bryan Laloge</strong> – Teacher/Counsellor</div>
                                        <div class="rc-staff-item"><strong>Sandra Drost</strong> – Educational Assistant</div>
                                    </div>
                                </div>
                            </div>
                            <div class="rc-proficiency-box">
                                <h3 class="rc-proficiency-title">Proficiency Scale</h3>
                                <div class="rc-box rc-proficiency-scale">
                                    <p><strong>EXTENDING (A 86–100%)</strong><br>
                                    The student demonstrates a sophisticated understanding of the concepts and competencies relevant to the expected learning.</p>
                                    <p><strong>PROFICIENT (B 73–85%)</strong><br>
                                    The student demonstrates a complete understanding of the concepts and competencies relevant to the expected learning.</p>
                                    <p><strong>DEVELOPING (C+ 67–72%, C 60–66%, C– 50–59%)</strong><br>
                                    The student demonstrates a partial understanding of the concepts and competencies relevant to the expected learning.</p>
                                    <p><strong>EMERGING (F &lt;50%)</strong><br>
                                    The student demonstrates initial understanding of the concepts and competencies relevant to the expected learning.</p>
                                    <p><strong>TRANSFER STANDING (TS)</strong><br>
                                    The student has fully met the normal requirements for the course; however, the school issuing the credit was not involved in the assessment process, and therefore cannot determine a letter grade.</p>
                                    <p><strong>STANDING GRANTED (SG)</strong><br>
                                    Completion of normal requirements is not possible; however, a sufficient level of performance has been demonstrated to warrant the granting of credit for the course.</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="rc-section rc-land-acknowledgement">
                        <h3>Land Acknowledgement</h3>
                        <div class="rc-box rc-land-acknowledgement-box">
                            <p>At the ILC we respectfully acknowledge that we work and learn within the traditional territories of the Kwanlin Dün First Nation and the Ta'an Kwäch'än Council.</p>
                        </div>
                    </div>

                    ${termCommentBlocks
                        ? `<div class="rc-section rc-teacher-comment">
                                <h3>Teacher Overall Comment</h3>
                                <div class="rc-box">${termCommentBlocks}</div>
                           </div>`
                        : ''
                    }

                    <div class="rc-section rc-courses-section">
                        <h3>Courses</h3>
                        <div class="rc-box rc-courses-box">
                            ${courseBlocks || '<p style="color:#475569;">No courses found for this student.</p>'}
                        </div>
                    </div>

                    <div class="rc-section rc-signature">
                        <div class="rc-signature-box"></div>
                        <div class="rc-signature-name">Maura Sullivan</div>
                    </div>
                </div>
            `;
        };

        let html = '';
        studentsToRender.forEach((student, idx) => {
            const pageName = `student-${student.id}`;
            html += `<div class="student-report-section" data-student-id="${student.id}" data-student-index="${idx}" style="page: ${pageName};">`;
            html += renderStudentReport(student);
            html += `</div>`;
            if (idx < studentsToRender.length - 1) {
                html += `<div class="section-break"></div>`;
            }
        });

        reportCardOutput.innerHTML = html;
        
        // Generate dynamic CSS for each student's named page to calculate total pages per student
        this.generateStudentPageStyles(studentsToRender);
    }
    
    generateStudentPageStyles(students) {
        // Create style element for student-specific page rules
        let styleId = 'student-page-styles';
        let styleEl = document.getElementById(styleId);
        if (styleEl) {
            styleEl.remove();
        }
        
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.setAttribute('media', 'print');
        
        let cssText = '';
        students.forEach(student => {
            const pageName = `student-${student.id}`;
            const studentName = this.formatNameForReport(student.name);
            const escapedName = this.escapeCssString(studentName);
            // Add @page rule for this student - counter(pages) will give total pages for this named page
            cssText += `@page ${pageName} {
                @top-right {
                    content: "${escapedName}";
                    font-family: 'Georgia', 'Times New Roman', serif;
                    font-size: 10pt;
                    color: #475569;
                    padding-top: 5mm;
                    text-align: right;
                }
            }\n`;
        });
        
        styleEl.textContent = cssText;
        document.head.appendChild(styleEl);
    }

    printReportCard() {
        const reportCardOutput = document.getElementById('report-card-output');
        if (!reportCardOutput || reportCardOutput.style.display === 'none') {
            alert('Please generate a report card first.');
            return;
        }
        window.print();
    }

    copyAspenText(textId) {
        const textarea = document.getElementById(textId);
        if (!textarea) return;

        const copyText = async () => {
            try {
                await navigator.clipboard.writeText(textarea.value);
                // Show temporary success feedback
                const btn = document.querySelector(`[data-text-id="${textId}"]`);
                if (btn) {
                    const originalText = btn.textContent;
                    btn.textContent = 'Copied!';
                    btn.style.backgroundColor = 'var(--success-color)';
                    setTimeout(() => {
                        btn.textContent = originalText;
                        btn.style.backgroundColor = '';
                    }, 2000);
                }
            } catch (err) {
                // Fallback
                textarea.select();
                try {
                    document.execCommand('copy');
                    const btn = document.querySelector(`[data-text-id="${textId}"]`);
                    if (btn) {
                        const originalText = btn.textContent;
                        btn.textContent = 'Copied!';
                        btn.style.backgroundColor = 'var(--success-color)';
                        setTimeout(() => {
                            btn.textContent = originalText;
                            btn.style.backgroundColor = '';
                        }, 2000);
                    }
                } catch (e) {
                    alert('Could not copy to clipboard. Please select and copy manually.');
                }
            }
        };
        
        copyText();
    }

    // Stock Comments
    async loadStockComments() {
        const comments = await this.getAll('stockComments');
        const container = document.getElementById('stock-comments-list');
        container.innerHTML = '';

        if (comments.length === 0) {
            container.innerHTML = '<p style="color: var(--secondary-color); margin-bottom: 15px;">No stock comments yet. Add some to speed up your reporting.</p>';
        } else {
            comments.forEach(comment => {
                const div = document.createElement('div');
                div.className = 'stock-comment-item';
                div.innerHTML = `
                    <input type="text" class="form-control" value="${this.escapeHtml(comment.text)}" data-id="${comment.id}">
                    <button class="btn btn-danger" onclick="tracker.deleteStockComment(${comment.id})">Delete</button>
                `;
                div.querySelector('input').addEventListener('change', (e) => {
                    this.updateStockComment(comment.id, e.target.value);
                });
                container.appendChild(div);
            });
        }
    }

    async addStockComment() {
        const text = prompt('Enter stock comment text:');
        if (text && text.trim()) {
            await this.add('stockComments', { text: text.trim() });
            this.loadStockComments();
            this.refreshStockCommentDropdowns(); // Refresh dropdowns in Record Competencies tab
        }
    }

    async updateStockComment(id, text) {
        const comment = await this.get('stockComments', id);
        comment.text = text.trim();
        await this.update('stockComments', comment);
        this.refreshStockCommentDropdowns(); // Refresh dropdowns in Record Competencies tab
    }

    async deleteStockComment(id) {
        if (confirm('Delete this stock comment?')) {
            await this.delete('stockComments', id);
            this.loadStockComments();
            this.refreshStockCommentDropdowns(); // Refresh dropdowns in Record Competencies tab
        }
    }

    // Refresh stock comment dropdowns in Record Competencies tab
    async refreshStockCommentDropdowns() {
        const stockComments = await this.getAll('stockComments');
        const container = document.getElementById('student-courses-container');
        
        if (!container || container.innerHTML === '') {
            return; // No forms loaded yet
        }

        // Find all stock comment dropdowns and update them
        const stockComment1Selects = container.querySelectorAll('select[id^="stock-comment-1-"]');
        const stockComment2Selects = container.querySelectorAll('select[id^="stock-comment-2-"]');

        // Update Stock Comment 1 dropdowns
        stockComment1Selects.forEach(select => {
            const currentValue = select.value; // Preserve current selection
            select.innerHTML = '<option value="">None</option>' + 
                stockComments.map(sc => `<option value="${sc.id}">${this.escapeHtml(sc.text)}</option>`).join('');
            select.value = currentValue; // Restore selection if it still exists
        });

        // Update Stock Comment 2 dropdowns
        stockComment2Selects.forEach(select => {
            const currentValue = select.value; // Preserve current selection
            select.innerHTML = '<option value="">None</option>' + 
                stockComments.map(sc => `<option value="${sc.id}">${this.escapeHtml(sc.text)}</option>`).join('');
            select.value = currentValue; // Restore selection if it still exists
        });
    }

    // Data Management
    async exportAllDataForSync() {
        return {
            students: await this.getAll('students'),
            courses: await this.getAll('courses'),
            records: await this.getAll('records'),
            stockComments: await this.getAll('stockComments'),
            attendance: await this.getAll('attendance'),
            nonInstructionalDays: await this.getAll('nonInstructionalDays'),
            attendanceColorIndicators: await this.getAll('attendanceColorIndicators'),
            attendanceNotes: await this.getAll('attendanceNotes'),
            teacherTracking: await this.getAll('teacherTracking'),
            exportedAt: new Date().toISOString()
        };
    }

    async exportAllData() {
        const data = await this.exportAllDataForSync();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `competency_tracker_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        window.URL.revokeObjectURL(url);
    }

    async importAllDataFromDrive(driveData) {
        // Merge data intelligently - don't replace, merge
        let updateCount = 0;
        
        // Merge students (update existing, add new)
        if (driveData.students) {
            const localStudents = await this.getAll('students');
            const localStudentMap = new Map(localStudents.map(s => [s.id, s]));
            
            for (const driveStudent of driveData.students) {
                const local = localStudentMap.get(driveStudent.id);
                if (local) {
                    // Update existing - merge properties, prefer newer data
                    const merged = { ...local, ...driveStudent };
                    if (driveStudent.updatedAt && (!local.updatedAt || driveStudent.updatedAt > local.updatedAt)) {
                        await this.update('students', merged);
                        updateCount++;
                    }
                } else {
                    // New student
                    await this.add('students', driveStudent);
                    updateCount++;
                }
            }
        }
        
        // Merge courses
        if (driveData.courses) {
            const localCourses = await this.getAll('courses');
            const localCourseMap = new Map(localCourses.map(c => [c.id, c]));
            
            for (const driveCourse of driveData.courses) {
                const local = localCourseMap.get(driveCourse.id);
                if (local) {
                    const merged = { ...local, ...driveCourse };
                    if (driveCourse.updatedAt && (!local.updatedAt || driveCourse.updatedAt > local.updatedAt)) {
                        await this.update('courses', merged);
                        updateCount++;
                    }
                } else {
                    await this.add('courses', driveCourse);
                    updateCount++;
                }
            }
        }
        
        // Merge records (competency records)
        if (driveData.records) {
            const localRecords = await this.getAll('records');
            const localRecordMap = new Map(localRecords.map(r => [`${r.studentId}-${r.courseId}`, r]));
            
            for (const driveRecord of driveData.records) {
                const key = `${driveRecord.studentId}-${driveRecord.courseId}`;
                const local = localRecordMap.get(key);
                if (local) {
                    const merged = { ...local, ...driveRecord };
                    if (driveRecord.updatedAt && (!local.updatedAt || driveRecord.updatedAt > local.updatedAt)) {
                        await this.update('records', merged);
                        updateCount++;
                    }
                } else {
                    await this.add('records', driveRecord);
                    updateCount++;
                }
            }
        }
        
        // Merge stock comments
        if (driveData.stockComments) {
            const localComments = await this.getAll('stockComments');
            const localCommentMap = new Map(localComments.map(c => [c.id, c]));
            
            for (const driveComment of driveData.stockComments) {
                const local = localCommentMap.get(driveComment.id);
                if (local) {
                    const merged = { ...local, ...driveComment };
                    if (driveComment.updatedAt && (!local.updatedAt || driveComment.updatedAt > local.updatedAt)) {
                        await this.update('stockComments', merged);
                        updateCount++;
                    }
                } else {
                    await this.add('stockComments', driveComment);
                    updateCount++;
                }
            }
        }
        
        // Merge attendance
        if (driveData.attendance) {
            const localAttendance = await this.getAll('attendance');
            const localAttendanceMap = new Map(localAttendance.map(a => [`${a.studentId}-${a.date}`, a]));
            
            for (const driveAttendance of driveData.attendance) {
                const key = `${driveAttendance.studentId}-${driveAttendance.date}`;
                const local = localAttendanceMap.get(key);
                if (local) {
                    const merged = { ...local, ...driveAttendance };
                    if (driveAttendance.updatedAt && (!local.updatedAt || driveAttendance.updatedAt > local.updatedAt)) {
                        await this.update('attendance', merged);
                        updateCount++;
                    }
                } else {
                    await this.add('attendance', driveAttendance);
                    updateCount++;
                }
            }
        }
        
        // Merge other data types
        const otherStores = ['nonInstructionalDays', 'attendanceColorIndicators', 'attendanceNotes', 'teacherTracking'];
        for (const storeName of otherStores) {
            if (driveData[storeName]) {
                const local = await this.getAll(storeName);
                const localMap = new Map(local.map(item => [item.id || item.date || item.studentId, item]));
                
                for (const driveItem of driveData[storeName]) {
                    const key = driveItem.id || driveItem.date || driveItem.studentId;
                    const localItem = localMap.get(key);
                    if (!localItem) {
                        await this.add(storeName, driveItem);
                        updateCount++;
                    }
                }
            }
        }
        
        return updateCount;
    }

    async importAllDataFromDrivePreferLocal(driveData) {
        // Merge data but prefer local data when there are conflicts
        // Only add new items from Drive, don't overwrite existing local items
        let updateCount = 0;
        
        // Merge students - only add new ones, don't overwrite existing
        if (driveData.students) {
            const localStudents = await this.getAll('students');
            const localStudentMap = new Map(localStudents.map(s => [s.id, s]));
            
            for (const driveStudent of driveData.students) {
                const local = localStudentMap.get(driveStudent.id);
                if (!local) {
                    // New student from Drive - add it
                    await this.add('students', driveStudent);
                    updateCount++;
                }
                // If local exists, keep local version (don't overwrite)
            }
        }
        
        // Merge courses - only add new ones
        if (driveData.courses) {
            const localCourses = await this.getAll('courses');
            const localCourseMap = new Map(localCourses.map(c => [c.id, c]));
            
            for (const driveCourse of driveData.courses) {
                const local = localCourseMap.get(driveCourse.id);
                if (!local) {
                    await this.add('courses', driveCourse);
                    updateCount++;
                }
            }
        }
        
        // Merge records - add new ones, update only if Drive has newer timestamp AND local doesn't have recent changes
        if (driveData.records) {
            const localRecords = await this.getAll('records');
            const localRecordMap = new Map(localRecords.map(r => [`${r.studentId}-${r.courseId}`, r]));
            
            for (const driveRecord of driveData.records) {
                const key = `${driveRecord.studentId}-${driveRecord.courseId}`;
                const local = localRecordMap.get(key);
                if (!local) {
                    // New record from Drive
                    await this.add('records', driveRecord);
                    updateCount++;
                } else {
                    // Both exist - only update if Drive is significantly newer (more than 1 minute)
                    const localTime = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
                    const driveTime = driveRecord.updatedAt ? new Date(driveRecord.updatedAt).getTime() : 0;
                    const timeDiff = driveTime - localTime;
                    // Only update if Drive is more than 1 minute newer (60000 ms)
                    if (timeDiff > 60000) {
                        const merged = { ...local, ...driveRecord };
                        await this.update('records', merged);
                        updateCount++;
                    }
                    // Otherwise keep local version
                }
            }
        }
        
        // Merge stock comments - only add new ones
        if (driveData.stockComments) {
            const localComments = await this.getAll('stockComments');
            const localCommentMap = new Map(localComments.map(c => [c.id, c]));
            
            for (const driveComment of driveData.stockComments) {
                const local = localCommentMap.get(driveComment.id);
                if (!local) {
                    await this.add('stockComments', driveComment);
                    updateCount++;
                }
            }
        }
        
        // Merge attendance - add new dates, but prefer local for same date
        if (driveData.attendance) {
            const localAttendance = await this.getAll('attendance');
            const localAttendanceMap = new Map(localAttendance.map(a => [`${a.studentId}-${a.date}`, a]));
            
            for (const driveAttendance of driveData.attendance) {
                const key = `${driveAttendance.studentId}-${driveAttendance.date}`;
                const local = localAttendanceMap.get(key);
                if (!local) {
                    // New attendance record from Drive
                    await this.add('attendance', driveAttendance);
                    updateCount++;
                } else {
                    // Both exist - only update if Drive is significantly newer
                    const localTime = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
                    const driveTime = driveAttendance.updatedAt ? new Date(driveAttendance.updatedAt).getTime() : 0;
                    const timeDiff = driveTime - localTime;
                    if (timeDiff > 60000) { // More than 1 minute newer
                        const merged = { ...local, ...driveAttendance };
                        await this.update('attendance', merged);
                        updateCount++;
                    }
                }
            }
        }
        
        // Merge other data types - only add new items
        const otherStores = ['nonInstructionalDays', 'attendanceColorIndicators', 'attendanceNotes', 'teacherTracking'];
        for (const storeName of otherStores) {
            if (driveData[storeName]) {
                const local = await this.getAll(storeName);
                const localMap = new Map(local.map(item => [item.id || item.date || item.studentId, item]));
                
                for (const driveItem of driveData[storeName]) {
                    const key = driveItem.id || driveItem.date || driveItem.studentId;
                    const localItem = localMap.get(key);
                    if (!localItem) {
                        await this.add(storeName, driveItem);
                        updateCount++;
                    }
                }
            }
        }
        
        return updateCount;
    }

    async importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                if (confirm('This will replace all existing data. Continue?')) {
                    // Clear existing data
                    await this.clearAllData();

                    // Import new data
                    if (data.students) {
                        for (const student of data.students) {
                            await this.add('students', student);
                        }
                    }
                    if (data.courses) {
                        for (const course of data.courses) {
                            await this.add('courses', course);
                        }
                    }
                    if (data.records) {
                        for (const record of data.records) {
                            await this.add('records', record);
                        }
                    }
                    if (data.stockComments) {
                        for (const comment of data.stockComments) {
                            await this.add('stockComments', comment);
                        }
                    }
                    if (data.attendance) {
                        for (const attendance of data.attendance) {
                            await this.add('attendance', attendance);
                        }
                    }
                    if (data.nonInstructionalDays) {
                        for (const day of data.nonInstructionalDays) {
                            await this.add('nonInstructionalDays', day);
                        }
                    }
                    if (data.attendanceColorIndicators) {
                        for (const indicator of data.attendanceColorIndicators) {
                            await this.add('attendanceColorIndicators', indicator);
                        }
                    }
                    if (data.attendanceNotes) {
                        for (const note of data.attendanceNotes) {
                            await this.add('attendanceNotes', note);
                        }
                    }
                    if (data.teacherTracking) {
                        for (const tracking of data.teacherTracking) {
                            await this.add('teacherTracking', tracking);
                        }
                    }

                    alert('Data imported successfully!');
                    this.loadData();
                }
            } catch (error) {
                alert('Error importing data: ' + error.message);
            }
        };
        reader.readAsText(file);
        event.target.value = ''; // Reset file input
    }

    async clearAllData() {
        const stores = [
            'students', 
            'courses', 
            'records', 
            'stockComments',
            'attendance',
            'attendanceColorIndicators',
            'attendanceNotes',
            'teacherTracking'
        ];
        for (const storeName of stores) {
            const all = await this.getAll(storeName);
            for (const item of all) {
                await this.delete(storeName, item.id);
            }
        }
        // Clear nonInstructionalDays (uses date as key, not id)
        const nonInstructionalDays = await this.getAll('nonInstructionalDays');
        for (const day of nonInstructionalDays) {
            await this.delete('nonInstructionalDays', day.date);
        }
        this.loadData();
    }

    loadData() {
        this.loadStudents();
        this.loadCourses();
        this.populateDropdowns();
    }

    // Team Collaboration - Export/Import Enrollments
    async exportEnrollments() {
        const students = await this.getAll('students');
        const courses = await this.getAll('courses');

        // Create CSV with all student-course relationships
        let csv = 'Student Name,Student ID,Course Name,Course ID,Grade Level,Enrolled\n';

        // Get all enrollments
        const enrollments = [];
        for (const course of courses) {
            const courseStudentIds = course.studentIds || [];
            for (const studentId of courseStudentIds) {
                const student = students.find(s => s.id === studentId);
                if (student) {
                    enrollments.push({
                        studentName: student.name,
                        studentId: student.id,
                        courseName: course.name,
                        courseId: course.id,
                        gradeLevel: course.grade
                    });
                }
            }
        }

        // Sort by student name, then course name
        enrollments.sort((a, b) => {
            if (a.studentName !== b.studentName) {
                return a.studentName.localeCompare(b.studentName);
            }
            return a.courseName.localeCompare(b.courseName);
        });

        // Write enrollments
        enrollments.forEach(enrollment => {
            csv += `"${enrollment.studentName}",${enrollment.studentId},"${enrollment.courseName}",${enrollment.courseId},"${enrollment.gradeLevel}",Yes\n`;
        });

        // Also include all students and courses for reference (marked as not enrolled)
        for (const student of students) {
            for (const course of courses) {
                const isEnrolled = (course.studentIds || []).includes(student.id);
                if (!isEnrolled) {
                    csv += `"${student.name}",${student.id},"${course.name}",${course.id},"${course.grade}",No\n`;
                }
            }
        }

        // Add BOM for Excel UTF-8 support
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `student_enrollments_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
        
        alert(`Exported ${enrollments.length} enrollment(s) to Excel file. Share this file on Teams for your team to update.`);
    }

    async importEnrollments(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const text = e.target.result;
                // Remove BOM if present
                const cleanText = text.replace(/^\uFEFF/, '');
                const lines = cleanText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
                
                if (lines.length < 2) {
                    alert('File appears to be empty or invalid. Please check the format.');
                    event.target.value = '';
                    return;
                }

                // Parse header
                const header = lines[0].toLowerCase();
                const expectedHeaders = ['student name', 'course name', 'enrolled'];
                const hasHeaders = expectedHeaders.some(h => header.includes(h));

                if (!hasHeaders) {
                    alert('Invalid file format. Expected columns: Student Name, Course Name, Enrolled');
                    event.target.value = '';
                    return;
                }

                // Parse CSV
                const parseCSVLine = (line) => {
                    const result = [];
                    let current = '';
                    let inQuotes = false;
                    
                    for (let i = 0; i < line.length; i++) {
                        const char = line[i];
                        if (char === '"') {
                            inQuotes = !inQuotes;
                        } else if (char === ',' && !inQuotes) {
                            result.push(current.trim());
                            current = '';
                        } else {
                            current += char;
                        }
                    }
                    result.push(current.trim());
                    return result;
                };

                const headerRow = parseCSVLine(lines[0]);
                const studentNameIndex = headerRow.findIndex(h => h.toLowerCase().includes('student'));
                const courseNameIndex = headerRow.findIndex(h => h.toLowerCase().includes('course'));
                const enrolledIndex = headerRow.findIndex(h => h.toLowerCase().includes('enrolled'));

                if (studentNameIndex === -1 || courseNameIndex === -1 || enrolledIndex === -1) {
                    alert('Could not find required columns: Student Name, Course Name, Enrolled');
                    event.target.value = '';
                    return;
                }

                // Get all students and courses
                const students = await this.getAll('students');
                const courses = await this.getAll('courses');

                let updated = 0;
                let notFound = 0;
                let errors = [];

                // Process each row
                for (let i = 1; i < lines.length; i++) {
                    const row = parseCSVLine(lines[i]);
                    if (row.length < Math.max(studentNameIndex, courseNameIndex, enrolledIndex) + 1) {
                        continue;
                    }

                    const studentName = row[studentNameIndex].replace(/^"|"$/g, '');
                    const courseName = row[courseNameIndex].replace(/^"|"$/g, '');
                    const enrolled = row[enrolledIndex].replace(/^"|"$/g, '').toLowerCase();

                    // Find matching student and course
                    const student = students.find(s => 
                        s.name.toLowerCase() === studentName.toLowerCase() ||
                        s.name.toLowerCase().includes(studentName.toLowerCase()) ||
                        studentName.toLowerCase().includes(s.name.toLowerCase())
                    );

                    const course = courses.find(c => 
                        c.name.toLowerCase() === courseName.toLowerCase() ||
                        c.name.toLowerCase().includes(courseName.toLowerCase()) ||
                        courseName.toLowerCase().includes(c.name.toLowerCase())
                    );

                    if (!student) {
                        notFound++;
                        errors.push(`Student not found: ${studentName}`);
                        continue;
                    }

                    if (!course) {
                        notFound++;
                        errors.push(`Course not found: ${courseName}`);
                        continue;
                    }

                    // Update enrollment
                    const shouldEnroll = enrolled === 'yes' || enrolled === 'y' || enrolled === 'true' || enrolled === '1';
                    
                    if (!course.studentIds) course.studentIds = [];
                    if (!student.courseIds) student.courseIds = [];

                    const isEnrolled = course.studentIds.includes(student.id);

                    if (shouldEnroll && !isEnrolled) {
                        course.studentIds.push(student.id);
                        student.courseIds.push(course.id);
                        await this.update('courses', course);
                        await this.update('students', student);
                        updated++;
                    } else if (!shouldEnroll && isEnrolled) {
                        course.studentIds = course.studentIds.filter(id => id !== student.id);
                        student.courseIds = student.courseIds.filter(id => id !== course.id);
                        await this.update('courses', course);
                        await this.update('students', student);
                        updated++;
                    }
                }

                // Show results
                let resultMsg = `Import complete!\n\n✅ Updated: ${updated} enrollment(s)`;
                if (notFound > 0) {
                    resultMsg += `\n❌ Not found: ${notFound}`;
                    if (errors.length <= 10) {
                        resultMsg += `\n\n${errors.slice(0, 10).join('\n')}`;
                        if (errors.length > 10) {
                            resultMsg += `\n... and ${errors.length - 10} more`;
                        }
                    }
                }
                alert(resultMsg);

                this.loadStudents();
                this.loadCourses();
                this.populateDropdowns();

            } catch (error) {
                alert('Error importing enrollments: ' + error.message);
                console.error(error);
            }
            
            event.target.value = '';
        };
        
        reader.readAsText(file);
    }

    // Google Drive Sync Functions
    async checkGoogleDriveConnection() {
        const savedToken = localStorage.getItem('googleDriveToken');
        const savedFileId = localStorage.getItem('googleDriveFileId');
        const savedEmail = localStorage.getItem('googleDriveEmail');
        const lastSync = localStorage.getItem('googleDriveLastSync');

        if (savedToken && savedFileId) {
            this.googleAccessToken = savedToken;
            this.googleDriveFileId = savedFileId;
            this.updateDriveUI(true, savedEmail, lastSync);
        } else {
            this.updateDriveUI(false);
        }
    }

    updateDriveUI(connected, email = null, lastSync = null) {
        const notConnected = document.getElementById('drive-not-connected');
        const connectedDiv = document.getElementById('drive-connected');
        const emailSpan = document.getElementById('drive-email');
        const lastSyncSpan = document.getElementById('last-sync-time');

        if (connected) {
            notConnected.style.display = 'none';
            connectedDiv.style.display = 'block';
            if (email) {
                emailSpan.textContent = `Account: ${email}`;
            }
            if (lastSync) {
                const syncDate = new Date(lastSync);
                lastSyncSpan.textContent = syncDate.toLocaleString();
            } else {
                lastSyncSpan.textContent = 'Never';
            }
        } else {
            notConnected.style.display = 'block';
            connectedDiv.style.display = 'none';
        }
    }

    // Diagnostic function to check Google Drive setup
    async diagnoseGoogleDrive() {
        console.log('=== Google Drive Diagnostic ===');
        console.log('Client ID configured:', this.googleClientId !== 'YOUR_CLIENT_ID.apps.googleusercontent.com' ? 'Yes' : 'No');
        console.log('Client ID:', this.googleClientId);
        console.log('Current URL:', window.location.href);
        console.log('Protocol:', window.location.protocol);
        console.log('Google API loaded:', !!window.google);
        console.log('Google Accounts loaded:', !!(window.google && window.google.accounts));
        console.log('GAPI loaded:', !!window.gapi);
        
        const savedToken = localStorage.getItem('googleDriveToken');
        const savedFileId = localStorage.getItem('googleDriveFileId');
        const savedEmail = localStorage.getItem('googleDriveEmail');
        
        console.log('Saved token:', savedToken ? 'Present (' + savedToken.substring(0, 20) + '...)' : 'Missing');
        console.log('Saved file ID:', savedFileId || 'Missing');
        if (savedFileId) {
            console.log('📁 File ID:', savedFileId);
            console.log('🔗 Direct link to file:', `https://drive.google.com/file/d/${savedFileId}/view`);
        }
        console.log('Saved email:', savedEmail || 'Missing');
        
        console.log('Instance token:', this.googleAccessToken ? 'Present' : 'Missing');
        console.log('Instance file ID:', this.googleDriveFileId || 'Missing');
        
        if (savedToken && savedFileId) {
            console.log('\n=== Testing Connection ===');
            try {
                // Test token validity by checking file access
                const testResponse = await fetch(
                    `https://www.googleapis.com/drive/v3/files/${savedFileId}?fields=id,name,permissions,capabilities`,
                    {
                        headers: {
                            'Authorization': `Bearer ${savedToken}`
                        }
                    }
                );
                
                console.log('Test response status:', testResponse.status);
                console.log('Test response OK:', testResponse.ok);
                
                if (testResponse.ok) {
                    const fileData = await testResponse.json();
                    console.log('File data:', fileData);
                    console.log('File name:', fileData.name);
                    console.log('File permissions:', fileData.permissions);
                    console.log('File capabilities:', fileData.capabilities);
                    console.log('✅ Connection is working!');
                    
                    // Test if we can actually download the file
                    console.log('\n=== Testing File Download ===');
                    const downloadTest = await fetch(
                        `https://www.googleapis.com/drive/v3/files/${savedFileId}?alt=media`,
                        {
                            headers: {
                                'Authorization': `Bearer ${savedToken}`
                            }
                        }
                    );
                    console.log('Download test status:', downloadTest.status);
                    if (downloadTest.ok) {
                        console.log('✅ File download works!');
                    } else {
                        const errorText = await downloadTest.text();
                        console.error('❌ File download failed:', downloadTest.status, errorText);
                    }
                    
                    // Test if we can upload to the file
                    console.log('\n=== Testing File Upload ===');
                    const uploadTest = await fetch(
                        `https://www.googleapis.com/upload/drive/v3/files/${savedFileId}?uploadType=media`,
                        {
                            method: 'PATCH',
                            headers: {
                                'Authorization': `Bearer ${savedToken}`,
                                'Content-Type': 'text/plain'
                            },
                            body: 'test'
                        }
                    );
                    console.log('Upload test status:', uploadTest.status);
                    if (uploadTest.ok || uploadTest.status === 200) {
                        console.log('✅ File upload works!');
                    } else {
                        const errorText = await uploadTest.text();
                        console.error('❌ File upload failed:', uploadTest.status, errorText);
                    }
                } else {
                    const errorText = await testResponse.text();
                    console.error('❌ Connection failed:', testResponse.status, testResponse.statusText);
                    console.error('Error details:', errorText);
                    
                    if (testResponse.status === 401) {
                        console.error('⚠️ Token is expired or invalid. Please reconnect.');
                    } else if (testResponse.status === 403) {
                        console.error('⚠️ Permission denied. Check file sharing settings.');
                        console.error('Make sure you have edit access to the file in Google Drive.');
                    } else if (testResponse.status === 404) {
                        console.error('⚠️ File not found. The file may have been deleted or moved.');
                        console.error('Try disconnecting and reconnecting to create a new file.');
                    }
                }
            } catch (error) {
                console.error('❌ Test failed:', error);
                console.error('Error message:', error.message);
                console.error('Error stack:', error.stack);
            }
        } else {
            console.log('⚠️ Not connected. Please connect to Google Drive first.');
        }
        
        console.log('=== End Diagnostic ===');
        return 'Check console for diagnostic results';
    }

    async connectGoogleDrive() {
        console.log('Starting Google Drive connection...');
        const connectBtn = document.getElementById('connect-drive-btn');
        if (connectBtn) {
            connectBtn.disabled = true;
            connectBtn.textContent = 'Connecting...';
        }

        try {
            // Check if client ID is configured
            if (this.googleClientId === 'YOUR_CLIENT_ID.apps.googleusercontent.com') {
                alert('Google Drive API is not configured yet.\n\nPlease see GOOGLE_DRIVE_SETUP.md for setup instructions.\n\nYou need to:\n1. Create a Google Cloud project\n2. Enable Google Drive API\n3. Create OAuth credentials\n4. Update the Client ID in app.js (line ~35)');
                if (connectBtn) {
                    connectBtn.disabled = false;
                    connectBtn.textContent = '🔗 Connect to Google Drive';
                }
                return;
            }

            console.log('Client ID configured:', this.googleClientId);

            // Check if running from file:// protocol (won't work with OAuth)
            if (window.location.protocol === 'file:') {
                alert('Google Drive connection requires the app to be served from a web server (http:// or https://), not opened directly as a file.\n\nPlease:\n1. Use a local web server (e.g., Python: python3 -m http.server)\n2. Or use a service like GitHub Pages\n3. Or use a local development server');
                if (connectBtn) {
                    connectBtn.disabled = false;
                    connectBtn.textContent = '🔗 Connect to Google Drive';
                }
                return;
            }

            // Check if Google APIs are loaded
            if (!window.google || !window.google.accounts) {
                console.warn('Google API not loaded yet. window.google:', window.google);
                console.log('Current URL:', window.location.href);
                console.log('Run tracker.diagnoseGoogleDrive() in console for diagnostics');
                alert('Google API is still loading. Please wait a moment and try again.\n\nIf this persists:\n1. Refresh the page\n2. Check your internet connection\n3. Check browser console (F12) for blocked scripts\n4. Run tracker.diagnoseGoogleDrive() in console for diagnostics');
                if (connectBtn) {
                    connectBtn.disabled = false;
                    connectBtn.textContent = '🔗 Connect to Google Drive';
                }
                return;
            }
            
            console.log('Google API loaded successfully');
            console.log('Current origin:', window.location.origin);

            // Note: We don't need to initialize gapi.client before getting OAuth token
            // We'll initialize it after we have the token in the callback

            // Use Google Identity Services for OAuth
            if (!window.google.accounts.oauth2) {
                alert('Google Identity Services not loaded. Please refresh the page and try again.');
                if (connectBtn) {
                    connectBtn.disabled = false;
                    connectBtn.textContent = '🔗 Connect to Google Drive';
                }
                return;
            }
            
            console.log('Initializing OAuth token client with Client ID:', this.googleClientId);

            const tokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: this.googleClientId,
                scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
                callback: async (response) => {
                    console.log('OAuth callback received:', response);
                    
                    if (response.error) {
                        let errorMsg = 'Error connecting to Google Drive: ' + response.error;
                        if (response.error === 'popup_closed_by_user') {
                            errorMsg = 'Connection cancelled. Please try again.';
                        } else if (response.error === 'access_denied') {
                            errorMsg = 'Access denied. Please grant the necessary permissions.';
                        } else if (response.error === 'invalid_client') {
                            errorMsg = 'Invalid Client ID. Please check your OAuth credentials in Google Cloud Console.';
                        }
                        alert(errorMsg);
                        console.error('OAuth error details:', response);
                        
                        const connectBtn = document.getElementById('connect-drive-btn');
                        if (connectBtn) {
                            connectBtn.disabled = false;
                            connectBtn.textContent = '🔗 Connect to Google Drive';
                        }
                        return;
                    }
                    
                    if (!response.access_token) {
                        alert('No access token received. Please try again.');
                        console.error('No access token in response:', response);
                        const connectBtn = document.getElementById('connect-drive-btn');
                        if (connectBtn) {
                            connectBtn.disabled = false;
                            connectBtn.textContent = '🔗 Connect to Google Drive';
                        }
                        return;
                    }

                    this.googleAccessToken = response.access_token;
                    console.log('Access token received');
                    
                    // Initialize gapi client if needed (for future API calls)
                    try {
                        if (window.gapi && window.gapi.load) {
                            // Load the client library if not already loaded
                            if (!window.gapi.client) {
                                await window.gapi.load('client');
                            }
                            
                            // Initialize with discovery docs
                            if (window.gapi.client && !window.gapi.client.drive) {
                                await window.gapi.client.init({
                                    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']
                                });
                            }
                            
                            // Set the token
                            if (window.gapi.client) {
                                window.gapi.client.setToken({ access_token: this.googleAccessToken });
                            }
                        }
                    } catch (gapiError) {
                        console.warn('Could not initialize gapi.client, but will use REST API instead:', gapiError);
                        // Continue anyway - we can use REST API directly
                    }
                    
                    // Get user info using the token
                    try {
                        const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                            headers: {
                                'Authorization': `Bearer ${this.googleAccessToken}`
                            }
                        });
                        const userInfo = await userInfoResponse.json();
                        if (userInfo.email) {
                            localStorage.setItem('googleDriveEmail', userInfo.email);
                        }
                    } catch (e) {
                        console.log('Could not get user email:', e);
                    }

                    // Find or create the sync file
                    try {
                        await this.findOrCreateDriveFile();
                        if (this.googleDriveFileId) {
                            console.log('Sync file ready. File ID:', this.googleDriveFileId);
                            console.log('You can find the file in Google Drive: BC_Curriculum_All_Data.json');
                        } else {
                            console.warn('File ID not set after findOrCreateDriveFile');
                        }
                    } catch (fileError) {
                        console.error('Error with Drive file:', fileError);
                        alert('Connected to Google Drive, but there was an error creating the sync file.\n\nError: ' + fileError.message + '\n\nPlease try syncing again.');
                    }
                    
                    localStorage.setItem('googleDriveToken', this.googleAccessToken);
                    this.updateDriveUI(true, localStorage.getItem('googleDriveEmail'));
                    
                    // Start auto-sync
                    this.startAutoSync();
                    
                    alert('Successfully connected to Google Drive!\n\nAuto-sync is now enabled (every 5 minutes).');
                }
            });

            console.log('Requesting access token...');
            tokenClient.requestAccessToken({ prompt: 'consent' });

        } catch (error) {
            console.error('Error connecting to Google Drive:', error);
            console.error('Error stack:', error.stack);
            
            let errorMessage = 'Error connecting to Google Drive: ' + error.message;
            if (error.message.includes('Failed to load')) {
                errorMessage += '\n\nThe Google API scripts may not have loaded. Please:\n1. Check your internet connection\n2. Refresh the page\n3. Check browser console (F12) for blocked scripts';
            } else if (error.message.includes('Failed to initialize')) {
                errorMessage += '\n\nPlease verify:\n1. Google Drive API is enabled in Google Cloud Console\n2. Your OAuth Client ID is correct\n3. Authorized JavaScript origins include your current URL';
            }
            
            alert(errorMessage + '\n\nCheck the browser console (F12) for more details.');
        } finally {
            const connectBtn = document.getElementById('connect-drive-btn');
            if (connectBtn) {
                connectBtn.disabled = false;
                connectBtn.textContent = '🔗 Connect to Google Drive';
            }
        }
    }

    async findOrCreateDriveFile() {
        try {
            const fileName = 'BC_Curriculum_All_Data.json';
            
            // Search for existing file using REST API
            const searchResponse = await fetch(
                `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(fileName)}' and trashed=false&fields=files(id,name)`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.googleAccessToken}`
                    }
                }
            );

            const searchData = await searchResponse.json();

            if (searchData.files && searchData.files.length > 0) {
                this.googleDriveFileId = searchData.files[0].id;
                localStorage.setItem('googleDriveFileId', this.googleDriveFileId);
            } else {
                // Create new file using REST API
                const fileMetadata = {
                    name: fileName,
                    mimeType: 'application/json'
                };

                const createResponse = await fetch(
                    'https://www.googleapis.com/drive/v3/files',
                    {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${this.googleAccessToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(fileMetadata)
                    }
                );

                if (!createResponse.ok) {
                    const errorText = await createResponse.text().catch(() => '');
                    console.error('Failed to create file:', createResponse.status, errorText);
                    throw new Error(`Failed to create file: ${createResponse.status} ${errorText}`);
                }

                const createData = await createResponse.json();
                if (!createData.id) {
                    console.error('File created but no ID returned:', createData);
                    throw new Error('File created but no ID returned from Google Drive');
                }
                
                this.googleDriveFileId = createData.id;
                localStorage.setItem('googleDriveFileId', this.googleDriveFileId);
                console.log('File created successfully. File ID:', this.googleDriveFileId);
                console.log('File name:', fileName);
            }
        } catch (error) {
            console.error('Error finding/creating Drive file:', error);
            throw error;
        }
    }

    async syncWithGoogleDrive(isManualSync = true) {
        // Reload connection state from localStorage in case it wasn't loaded
        const savedToken = localStorage.getItem('googleDriveToken');
        const savedFileId = localStorage.getItem('googleDriveFileId');
        
        if (savedToken) {
            this.googleAccessToken = savedToken;
        }
        if (savedFileId) {
            this.googleDriveFileId = savedFileId;
        }
        
        if (!this.googleAccessToken || !this.googleDriveFileId) {
            if (isManualSync) {
                alert('Please connect to Google Drive first.\n\nClick "Connect to Google Drive" to establish a connection.');
            }
            return;
        }

        const syncBtn = document.getElementById('sync-drive-btn');
        if (syncBtn && isManualSync) {
            syncBtn.disabled = true;
            syncBtn.textContent = 'Syncing...';
        }

        try {
            // FIRST: Upload current local data to Drive (save local changes)
            // This ensures your local changes are saved before merging
            const allData = await this.exportAllDataForSync();
            const jsonContent = JSON.stringify(allData, null, 2);
            
            // Use simple upload for small files
            const uploadResponse = await fetch(
                `https://www.googleapis.com/upload/drive/v3/files/${this.googleDriveFileId}?uploadType=media`,
                {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${this.googleAccessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: jsonContent
                }
            );

            if (uploadResponse.status === 401) {
                // Token expired during upload
                const errorData = await uploadResponse.text().catch(() => '');
                console.error('Token expired during upload. Response:', errorData);
                alert('Your Google Drive connection has expired. Please reconnect by clicking "Connect to Google Drive".');
                this.googleAccessToken = null;
                this.googleDriveFileId = null;
                localStorage.removeItem('googleDriveToken');
                localStorage.removeItem('googleDriveFileId');
                this.updateDriveUI(false);
                return;
            }
            
            if (uploadResponse.status === 403) {
                // Permission denied during upload
                const errorData = await uploadResponse.text().catch(() => '');
                console.error('Permission denied during upload. Response:', errorData);
                throw new Error('Permission denied (403). You may not have edit access to this file. Check Google Drive sharing settings.');
            }

            if (!uploadResponse.ok) {
                const errorText = await uploadResponse.text().catch(() => '');
                console.error('Upload error response:', uploadResponse.status, errorText);
                throw new Error(`Failed to upload to Google Drive: ${uploadResponse.status} ${uploadResponse.statusText}. ${errorText.substring(0, 200)}`);
            }

            console.log('✅ Local data uploaded to Google Drive successfully');

            // THEN: Download from Drive to get team updates (but don't overwrite local changes)
            const downloadResponse = await fetch(
                `https://www.googleapis.com/drive/v3/files/${this.googleDriveFileId}?alt=media`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.googleAccessToken}`
                    }
                }
            );

            // Check response status and handle errors
            if (downloadResponse.status === 401) {
                // Token expired, but upload already succeeded, so just warn
                console.warn('Token expired after upload. Upload was successful.');
                // Don't return, continue with UI update
            } else if (downloadResponse.status === 403) {
                // Permission denied - but upload worked, so continue
                console.warn('Permission denied for download, but upload succeeded.');
            } else if (downloadResponse.status === 404) {
                // File not found - shouldn't happen after upload, but handle gracefully
                console.warn('File not found after upload - this is unexpected.');
            } else if (downloadResponse.ok) {
                // Download successful - merge team updates (but preserve local changes)
                const driveContent = await downloadResponse.text();
                
                if (driveContent.trim().length > 0) {
                    try {
                        const driveData = JSON.parse(driveContent);
                        // Merge but prefer local data when there are conflicts
                        const importedCount = await this.importAllDataFromDrivePreferLocal(driveData);
                        if (importedCount > 0 && isManualSync) {
                            console.log(`Merged ${importedCount} new/updated items from team`);
                        }
                    } catch (parseError) {
                        console.error('Error parsing Drive data:', parseError);
                        // Try legacy CSV import for backward compatibility
                        await this.importEnrollmentsFromText(driveContent);
                    }
                }
            }

            // Update last sync time
            const now = new Date().toISOString();
            localStorage.setItem('googleDriveLastSync', now);
            this.updateDriveUI(true, localStorage.getItem('googleDriveEmail'), now);

            // Reload all data to reflect changes
            await this.loadStudents();
            await this.loadCourses();
            
            // Show notification (silent for auto-sync, alert for manual sync)
            if (isManualSync) {
                let message = 'Successfully synced with Google Drive!';
                if (importedCount > 0) {
                    message += `\n\nImported ${importedCount} update(s) from team.`;
                }
                alert(message);
            } else {
                // Silent sync - just update UI
                console.log('Auto-sync completed', importedCount > 0 ? `(${importedCount} updates imported)` : '');
            }

        } catch (error) {
            console.error('Error syncing with Google Drive:', error);
            console.error('Error details:', {
                message: error.message,
                stack: error.stack,
                token: this.googleAccessToken ? 'Present' : 'Missing',
                fileId: this.googleDriveFileId || 'Missing'
            });
            
            let errorMessage = 'Error syncing with Google Drive: ' + error.message;
            if (error.message.includes('401') || error.message.includes('expired') || error.message.includes('Unauthorized')) {
                errorMessage += '\n\nYour connection has expired. Please reconnect by clicking "Connect to Google Drive".';
                this.googleAccessToken = null;
                this.googleDriveFileId = null;
                localStorage.removeItem('googleDriveToken');
                localStorage.removeItem('googleDriveFileId');
                this.updateDriveUI(false);
            } else if (error.message.includes('403') || error.message.includes('permission') || error.message.includes('Forbidden')) {
                errorMessage += '\n\nYou may not have permission to access this file. Check Google Drive sharing settings.\n\nPlease verify:\n1. The file exists in your Google Drive\n2. You have edit access to the file\n3. The file hasn\'t been moved or deleted';
            } else {
                errorMessage += '\n\nCheck the browser console (F12) for more details.';
            }
            alert(errorMessage);
        } finally {
            const syncBtn = document.getElementById('sync-drive-btn');
            if (syncBtn) {
                syncBtn.disabled = false;
                syncBtn.textContent = '🔄 Sync Now';
            }
        }
    }

    async generateEnrollmentsCSV() {
        const students = await this.getAll('students');
        const courses = await this.getAll('courses');

        let csv = 'Student Name,Student ID,Course Name,Course ID,Grade Level,Enrolled\n';

        const enrollments = [];
        for (const course of courses) {
            const courseStudentIds = course.studentIds || [];
            for (const studentId of courseStudentIds) {
                const student = students.find(s => s.id === studentId);
                if (student) {
                    enrollments.push({
                        studentName: student.name,
                        studentId: student.id,
                        courseName: course.name,
                        courseId: course.id,
                        gradeLevel: course.grade
                    });
                }
            }
        }

        enrollments.sort((a, b) => {
            if (a.studentName !== b.studentName) {
                return a.studentName.localeCompare(b.studentName);
            }
            return a.courseName.localeCompare(b.courseName);
        });

        enrollments.forEach(enrollment => {
            csv += `"${enrollment.studentName}",${enrollment.studentId},"${enrollment.courseName}",${enrollment.courseId},"${enrollment.gradeLevel}",Yes\n`;
        });

        for (const student of students) {
            for (const course of courses) {
                const isEnrolled = (course.studentIds || []).includes(student.id);
                if (!isEnrolled) {
                    csv += `"${student.name}",${student.id},"${course.name}",${course.id},"${course.grade}",No\n`;
                }
            }
        }

        const BOM = '\uFEFF';
        return BOM + csv;
    }

    async importEnrollmentsFromText(text) {
        // Reuse the import logic from importEnrollments
        const cleanText = text.replace(/^\uFEFF/, '');
        const lines = cleanText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        if (lines.length < 2) return;

        const parseCSVLine = (line) => {
            const result = [];
            let current = '';
            let inQuotes = false;
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    result.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            result.push(current.trim());
            return result;
        };

        const headerRow = parseCSVLine(lines[0]);
        const studentNameIndex = headerRow.findIndex(h => h.toLowerCase().includes('student'));
        const courseNameIndex = headerRow.findIndex(h => h.toLowerCase().includes('course'));
        const enrolledIndex = headerRow.findIndex(h => h.toLowerCase().includes('enrolled'));

        if (studentNameIndex === -1 || courseNameIndex === -1 || enrolledIndex === -1) return;

        const students = await this.getAll('students');
        const courses = await this.getAll('courses');

        let updated = 0;

        for (let i = 1; i < lines.length; i++) {
            const row = parseCSVLine(lines[i]);
            if (row.length < Math.max(studentNameIndex, courseNameIndex, enrolledIndex) + 1) continue;

            const studentName = row[studentNameIndex].replace(/^"|"$/g, '');
            const courseName = row[courseNameIndex].replace(/^"|"$/g, '');
            const enrolled = row[enrolledIndex].replace(/^"|"$/g, '').toLowerCase();

            const student = students.find(s => 
                s.name.toLowerCase() === studentName.toLowerCase() ||
                s.name.toLowerCase().includes(studentName.toLowerCase()) ||
                studentName.toLowerCase().includes(s.name.toLowerCase())
            );

            const course = courses.find(c => 
                c.name.toLowerCase() === courseName.toLowerCase() ||
                c.name.toLowerCase().includes(courseName.toLowerCase()) ||
                courseName.toLowerCase().includes(c.name.toLowerCase())
            );

            if (!student || !course) continue;

            const shouldEnroll = enrolled === 'yes' || enrolled === 'y' || enrolled === 'true' || enrolled === '1';
            
            if (!course.studentIds) course.studentIds = [];
            if (!student.courseIds) student.courseIds = [];

            const isEnrolled = course.studentIds.includes(student.id);

            if (shouldEnroll && !isEnrolled) {
                course.studentIds.push(student.id);
                student.courseIds.push(course.id);
                await this.update('courses', course);
                await this.update('students', student);
                updated++;
            } else if (!shouldEnroll && isEnrolled) {
                course.studentIds = course.studentIds.filter(id => id !== student.id);
                student.courseIds = student.courseIds.filter(id => id !== course.id);
                await this.update('courses', course);
                await this.update('students', student);
                updated++;
            }
        }

        return updated;
    }

    disconnectGoogleDrive() {
        if (confirm('Disconnect from Google Drive? You can reconnect anytime.')) {
            this.stopAutoSync();
            this.googleAccessToken = null;
            this.googleDriveFileId = null;
            localStorage.removeItem('googleDriveToken');
            localStorage.removeItem('googleDriveFileId');
            localStorage.removeItem('googleDriveEmail');
            localStorage.removeItem('googleDriveLastSync');
            this.updateDriveUI(false);
            alert('Disconnected from Google Drive.');
        }
    }

    startAutoSync() {
        // Stop any existing auto-sync
        this.stopAutoSync();
        
        // Check if connected
        const savedToken = localStorage.getItem('googleDriveToken');
        const savedFileId = localStorage.getItem('googleDriveFileId');
        
        if (savedToken && savedFileId) {
            this.googleAccessToken = savedToken;
            this.googleDriveFileId = savedFileId;
            
            // Sync every 5 minutes (300,000 milliseconds)
            this.autoSyncInterval = setInterval(async () => {
                try {
                    console.log('Auto-syncing with Google Drive...');
                    await this.syncWithGoogleDrive(false); // false = auto-sync, no alerts
                } catch (error) {
                    console.error('Auto-sync error:', error);
                    // Don't alert on auto-sync errors, just log them
                }
            }, 5 * 60 * 1000); // 5 minutes
            
            console.log('Auto-sync started (every 5 minutes)');
        }
    }

    stopAutoSync() {
        if (this.autoSyncInterval) {
            clearInterval(this.autoSyncInterval);
            this.autoSyncInterval = null;
            console.log('Auto-sync stopped');
        }
    }

    // IndexedDB Helper Methods
    async getAll(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    async get(storeName, id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(id);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    async add(storeName, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.add(data);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    async update(storeName, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    async delete(storeName, id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(id);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    }

    // ==================== ATTENDANCE MANAGEMENT ====================

    // Get Yukon holidays for a given year
    getYukonHolidays(year) {
        // Fixed date holidays
        const holidays = [
            { month: 0, day: 1, name: "New Year's Day" },
            { month: 6, day: 1, name: "Canada Day" },
            { month: 7, day: 1, name: "Discovery Day" },
            { month: 10, day: 11, name: "Remembrance Day" },
            { month: 11, day: 25, name: "Christmas Day" },
            { month: 11, day: 26, name: "Boxing Day" }
        ];

        // Calculate variable holidays (Easter-based)
        const easter = this.calculateEaster(year);
        const goodFriday = new Date(easter);
        goodFriday.setDate(easter.getDate() - 2);
        holidays.push({ month: goodFriday.getMonth(), day: goodFriday.getDate(), name: "Good Friday" });
        holidays.push({ month: easter.getMonth(), day: easter.getDate(), name: "Easter Monday" });

        // Victoria Day (last Monday before May 25)
        const victoriaDay = new Date(year, 4, 25); // May 25
        while (victoriaDay.getDay() !== 1) {
            victoriaDay.setDate(victoriaDay.getDate() - 1);
        }
        holidays.push({ month: victoriaDay.getMonth(), day: victoriaDay.getDate(), name: "Victoria Day" });

        // Labour Day (first Monday in September)
        const labourDay = new Date(year, 8, 1);
        while (labourDay.getDay() !== 1) {
            labourDay.setDate(labourDay.getDate() + 1);
        }
        holidays.push({ month: labourDay.getMonth(), day: labourDay.getDate(), name: "Labour Day" });

        // Thanksgiving (second Monday in October)
        const thanksgiving = new Date(year, 9, 8);
        while (thanksgiving.getDay() !== 1) {
            thanksgiving.setDate(thanksgiving.getDate() + 1);
        }
        holidays.push({ month: thanksgiving.getMonth(), day: thanksgiving.getDate(), name: "Thanksgiving" });

        return holidays.map(h => {
            const date = new Date(year, h.month, h.day);
            return date.toISOString().split('T')[0];
        });
    }

    // Calculate Easter date (using algorithm)
    calculateEaster(year) {
        const a = year % 19;
        const b = Math.floor(year / 100);
        const c = year % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31);
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(year, month - 1, day);
    }

    // Check if a date is a weekend
    isWeekend(dateString) {
        // Parse date string (YYYY-MM-DD) to avoid timezone issues
        const parts = dateString.split('-');
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
        const day = parseInt(parts[2], 10);
        const date = new Date(year, month, day);
        const dayOfWeek = date.getDay();
        return dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
    }

    // Check if a date is a Yukon holiday
    async isYukonHoliday(dateString) {
        const date = new Date(dateString);
        const year = date.getFullYear();
        const holidays = this.getYukonHolidays(year);
        return holidays.includes(dateString);
    }

    // Check if a date is marked as non-instructional
    async isNonInstructionalDay(dateString) {
        try {
            const allNonInstructional = await this.getAll('nonInstructionalDays');
            return allNonInstructional.some(record => record.date === dateString);
        } catch (e) {
            return false;
        }
    }

    // Toggle non-instructional day status
    async toggleNonInstructionalDay(isNonInstructional) {
        const dateInput = document.getElementById('attendance-date');
        if (!dateInput || !dateInput.value) {
            alert('Please select a date first.');
            return;
        }

        const dateString = dateInput.value;

        if (isNonInstructional) {
            await this.add('nonInstructionalDays', { date: dateString });
        } else {
            try {
                // Find and delete the record (date is the keyPath)
                const allNonInstructional = await this.getAll('nonInstructionalDays');
                const record = allNonInstructional.find(r => r.date === dateString);
                if (record) {
                    // Since date is the keyPath, we can delete using the date directly
                    const transaction = this.db.transaction(['nonInstructionalDays'], 'readwrite');
                    const store = transaction.objectStore('nonInstructionalDays');
                    await new Promise((resolve, reject) => {
                        const request = store.delete(dateString);
                        request.onsuccess = () => resolve();
                        request.onerror = () => reject(request.error);
                    });
                }
            } catch (e) {
                // Ignore if doesn't exist
            }
        }

        // Reload attendance to reflect the change
        await this.loadAttendanceForDate();
    }

    // Ensure weekends are saved as non-instructional days
    async ensureWeekendsAreNonInstructional() {
        const currentYear = new Date().getFullYear();
        const yearsToCheck = [currentYear - 1, currentYear, currentYear + 1]; // Check past, current, and next year
        
        // First, clean up any Mondays that were incorrectly saved (except holidays)
        await this.cleanupIncorrectMondays(yearsToCheck);
        
        for (const year of yearsToCheck) {
            // Get all weekends for the year
            const startDate = new Date(year, 0, 1);
            const endDate = new Date(year, 11, 31);
            
            for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
                // Format date as YYYY-MM-DD to avoid timezone issues
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const dateString = `${year}-${month}-${day}`;
                
                if (this.isWeekend(dateString)) {
                    // Check if already saved
                    const isAlreadySaved = await this.isNonInstructionalDay(dateString);
                    if (!isAlreadySaved) {
                        // Save as non-instructional day
                        try {
                            await this.add('nonInstructionalDays', { date: dateString });
                        } catch (e) {
                            // Ignore if already exists
                        }
                    }
                }
            }
        }
    }

    // Clean up any Mondays that were incorrectly saved as non-instructional (except holidays)
    async cleanupIncorrectMondays(yearsToCheck) {
        const allNonInstructional = await this.getAll('nonInstructionalDays');
        const allHolidays = new Set();
        
        // Get all holidays for the years
        for (const year of yearsToCheck) {
            const holidays = this.getYukonHolidays(year);
            holidays.forEach(h => allHolidays.add(h));
        }
        
        // Check each non-instructional day
        for (const record of allNonInstructional) {
            const dateString = record.date;
            
            // Parse the date to check day of week
            const parts = dateString.split('-');
            const year = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const day = parseInt(parts[2], 10);
            const date = new Date(year, month, day);
            const dayOfWeek = date.getDay();
            
            // If it's a Monday (dayOfWeek === 1) and not a holiday, remove it
            if (dayOfWeek === 1 && !allHolidays.has(dateString)) {
                try {
                    const transaction = this.db.transaction(['nonInstructionalDays'], 'readwrite');
                    const store = transaction.objectStore('nonInstructionalDays');
                    await new Promise((resolve, reject) => {
                        const request = store.delete(dateString);
                        request.onsuccess = () => resolve();
                        request.onerror = () => reject(request.error);
                    });
                } catch (e) {
                    // Ignore errors
                }
            }
        }
    }

    // Ensure holidays are saved as non-instructional days
    async ensureHolidaysAreNonInstructional() {
        const currentYear = new Date().getFullYear();
        const yearsToCheck = [currentYear - 1, currentYear, currentYear + 1];
        
        for (const year of yearsToCheck) {
            const holidays = this.getYukonHolidays(year);
            
            for (const holidayDate of holidays) {
                const isAlreadySaved = await this.isNonInstructionalDay(holidayDate);
                if (!isAlreadySaved) {
                    try {
                        await this.add('nonInstructionalDays', { date: holidayDate });
                    } catch (e) {
                        // Ignore if already exists
                    }
                }
            }
        }
    }

    // Navigate to previous or next day
    async navigateDate(daysOffset) {
        const dateInput = document.getElementById('attendance-date');
        if (!dateInput || !dateInput.value) {
            return;
        }

        // Parse date string (YYYY-MM-DD) to avoid timezone issues
        const dateString = dateInput.value;
        const parts = dateString.split('-');
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
        const day = parseInt(parts[2], 10);
        
        // Create date in local timezone
        const currentDate = new Date(year, month, day);
        
        // Add or subtract exactly one day
        currentDate.setDate(currentDate.getDate() + daysOffset);
        
        // Format as YYYY-MM-DD
        const newYear = currentDate.getFullYear();
        const newMonth = String(currentDate.getMonth() + 1).padStart(2, '0');
        const newDay = String(currentDate.getDate()).padStart(2, '0');
        const newDateString = `${newYear}-${newMonth}-${newDay}`;
        
        dateInput.value = newDateString;
        await this.loadAttendanceForDate();
    }

    // Load attendance for a specific date
    async loadAttendanceForDate() {
        const dateInput = document.getElementById('attendance-date');
        if (!dateInput || !dateInput.value) {
            return;
        }

        const dateString = dateInput.value;
        
        // Ensure weekends and holidays are saved as non-instructional (run once per session)
        if (!this._weekendsInitialized) {
            await this.ensureWeekendsAreNonInstructional();
            await this.ensureHolidaysAreNonInstructional();
            this._weekendsInitialized = true;
        }
        
        // Also ensure the current date is saved if it's a weekend or holiday
        const isWeekendDay = this.isWeekend(dateString);
        const isHoliday = await this.isYukonHoliday(dateString);
        
        if (isWeekendDay || isHoliday) {
            const isAlreadySaved = await this.isNonInstructionalDay(dateString);
            if (!isAlreadySaved) {
                try {
                    await this.add('nonInstructionalDays', { date: dateString });
                } catch (e) {
                    // Ignore if already exists
                }
            }
        }
        
        const students = await this.getAll('students');
        const attendanceRecords = await this.getAll('attendance');
        const isNonInstructional = await this.isNonInstructionalDay(dateString);

        // Update non-instructional checkbox
        const nonInstructionalCheckbox = document.getElementById('non-instructional-day');
        if (nonInstructionalCheckbox) {
            nonInstructionalCheckbox.checked = isNonInstructional || isHoliday || isWeekendDay;
            nonInstructionalCheckbox.disabled = isHoliday || isWeekendDay; // Can't uncheck holidays/weekends
        }

        // Get attendance records for this date
        const dateAttendance = attendanceRecords.filter(a => a.date === dateString);
        const attendanceMap = new Map();
        dateAttendance.forEach(a => {
            attendanceMap.set(a.studentId, a.status);
        });

        // Keep all students in the list, including graduated ones
        // Sort students alphabetically
        const sortedStudents = students.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        // Build attendance list
        const container = document.getElementById('attendance-list');
        if (!container) return;

        if (sortedStudents.length === 0) {
            container.innerHTML = '<p class="empty-state">No students found. Add students in the Students tab first.</p>';
            return;
        }

        // Calculate consecutive absences and check recent attendance for each student
        // Note: Only skip tracking for graduated students (grad list students still need tracking)
        const studentAttendanceInfo = await Promise.all(
            sortedStudents.map(async (student) => {
                // If student is graduated, skip absence tracking
                if (student.graduated) {
                    return { studentId: student.id, consecutiveDays: 0, hasRecentPresence: true, manualColor: null };
                }
                // Continue tracking for grad list students
                const consecutiveDays = await this.calculateConsecutiveAbsences(student.id, dateString);
                const hasRecentPresence = await this.hasRecentPresence(student.id, dateString);
                const manualColor = await this.getManualColorIndicator(student.id);
                return { studentId: student.id, consecutiveDays, hasRecentPresence, manualColor };
            })
        );

        const attendanceInfoMap = new Map();
        studentAttendanceInfo.forEach(({ studentId, consecutiveDays, hasRecentPresence, manualColor }) => {
            attendanceInfoMap.set(studentId, { consecutiveDays, hasRecentPresence, manualColor });
        });

        let html = '<div class="attendance-table">';
        html += '<div class="attendance-header">';
        html += '<div class="attendance-student-col">Student Name</div>';
        html += '<div class="attendance-status-col">Status</div>';
        html += '<div class="attendance-notes-col"></div>';
        html += '</div>';

        // Render notes for all students first
        const notesPromises = sortedStudents.map(student => 
            this.renderAttendanceNotes(student.id).then(notesHtml => ({ studentId: student.id, notesHtml }))
        );
        const notesMap = new Map();
        (await Promise.all(notesPromises)).forEach(({ studentId, notesHtml }) => {
            notesMap.set(studentId, notesHtml);
        });
        
        // Get teacher tracking for all students
        const teacherTrackingPromises = sortedStudents.map(async student => {
            const teacher = await this.getTeacherTracking(student.id);
            return { studentId: student.id, teacher };
        });
        const teacherTrackingMap = new Map();
        (await Promise.all(teacherTrackingPromises)).forEach(({ studentId, teacher }) => {
            teacherTrackingMap.set(studentId, teacher);
        });

        sortedStudents.forEach(student => {
            const status = attendanceMap.get(student.id) || 'absent';
            const isDisabled = isNonInstructional || isHoliday || isWeekendDay;
            const info = attendanceInfoMap.get(student.id) || { consecutiveDays: 0, hasRecentPresence: false, manualColor: null };
            const { consecutiveDays, hasRecentPresence, manualColor } = info;
            const isOnGradList = student.onGradList || false;
            const isGraduated = student.graduated || false;

            // Determine color indicator (skip only if graduated)
            let colorClass = '';
            let colorIndicator = '';
            
            if (!isGraduated) {
                // Show color indicators for all students except graduated ones (including grad list students)
                if (manualColor) {
                    // Manual color selection takes precedence
                    colorClass = `attendance-color-${manualColor}`;
                    colorIndicator = manualColor;
                } else {
                    // Automatic tracking
                    if (hasRecentPresence) {
                        colorClass = 'attendance-color-green';
                        colorIndicator = 'green';
                    } else if (consecutiveDays >= 15) {
                        colorClass = 'attendance-color-red';
                        colorIndicator = 'red';
                    } else if (consecutiveDays >= 1) {
                        // Yellow for 1-7 consecutive absences (inclusive)
                        colorClass = 'attendance-color-yellow';
                        colorIndicator = 'yellow';
                    }
                }
            }
            
            html += `<div class="attendance-row" data-student-id="${student.id}">`;
            html += `<div class="attendance-student-col">`;
            html += `<div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">`;
            
            // Add grad list badge if applicable (with green check if graduated)
            if (isOnGradList || isGraduated) {
                const badgeClass = isGraduated ? 'grad-list-badge graduated-badge' : 'grad-list-badge';
                const badgeTitle = isGraduated ? 'Graduated' : 'On Graduation List';
                const badgeContent = isGraduated ? '🎓✅' : '🎓';
                html += `<span class="${badgeClass}" title="${badgeTitle}">${badgeContent}</span>`;
            }
            
            // Student name with color indicator (only if not on grad list, as grad list takes precedence visually)
            html += `<span class="attendance-student-name ${colorClass}" data-student-id="${student.id}" data-consecutive-days="${consecutiveDays}" data-color-indicator="${colorIndicator}" style="cursor: pointer; padding: 4px 8px; border-radius: 4px; display: inline-block;" title="Click to view details and change color">${this.escapeHtml(student.name)}</span>`;
            
            // Display teacher tracking badge
            const trackingTeacher = teacherTrackingMap.get(student.id);
            if (trackingTeacher) {
                html += `<span class="teacher-tracking-badge" title="Teacher Tracking: ${this.escapeHtml(trackingTeacher)}">${this.escapeHtml(trackingTeacher)}</span>`;
            }
            
            html += `</div>`;
            html += `</div>`;
            html += `<div class="attendance-status-col">`;
            html += `<label class="attendance-toggle">`;
            html += `<input type="checkbox" class="attendance-checkbox" data-student-id="${student.id}" ${status === 'present' ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}>`;
            html += `<span class="attendance-toggle-slider"></span>`;
            html += `<span class="attendance-status-text">${status === 'present' ? 'Present' : 'Absent'}</span>`;
            html += `</label>`;
            html += `</div>`;
            html += `<div class="attendance-notes-col" data-student-id="${student.id}">`;
            html += notesMap.get(student.id) || '';
            html += `</div>`;
            html += `</div>`;
        });

        html += '</div>';

        // Add info message if non-instructional
        if (isNonInstructional || isHoliday || isWeekendDay) {
            let reason = '';
            if (isWeekendDay) reason = 'Weekend';
            else if (isHoliday) reason = 'Yukon Holiday';
            else if (isNonInstructional) reason = 'Non-Instructional Day';
            
            html += `<div class="attendance-info" style="margin-top: 20px; padding: 15px; background: var(--bg-color); border-radius: 8px; color: var(--text-color);">`;
            html += `<strong>ℹ️ This is a ${reason}</strong> - Attendance cannot be recorded for this day.`;
            html += `</div>`;
        }

        container.innerHTML = html;

        // Add event listeners for notes editing
        this.setupAttendanceNotesListeners();

        // Store original state for unsaved changes tracking
        this.attendanceOriginalState.clear();
        attendanceMap.forEach((status, studentId) => {
            this.attendanceOriginalState.set(studentId, status);
        });
        this.attendanceHasUnsavedChanges = false;

        // Add event listeners to checkboxes
        container.querySelectorAll('.attendance-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const studentId = parseInt(e.target.dataset.studentId);
                const status = e.target.checked ? 'present' : 'absent';
                // Mark as having unsaved changes
                this.attendanceHasUnsavedChanges = true;
                // Update the status text immediately for visual feedback
                const statusText = e.target.closest('.attendance-toggle').querySelector('.attendance-status-text');
                if (statusText) {
                    statusText.textContent = status === 'present' ? 'Present' : 'Absent';
                }
            });
        });

        // Add event listeners to student names for color indicator dropdown
        container.querySelectorAll('.attendance-student-name').forEach(nameElement => {
            nameElement.addEventListener('click', async (e) => {
                e.stopPropagation();
                const studentId = parseInt(e.target.dataset.studentId);
                const consecutiveDays = parseInt(e.target.dataset.consecutiveDays) || 0;
                const currentColor = e.target.dataset.colorIndicator || '';
                await this.showAttendanceColorMenu(studentId, consecutiveDays, currentColor, e.target);
            });
        });
    }

    // Check if student has been present in the last 7 instructional days
    async hasRecentPresence(studentId, endDateString) {
        const endDate = new Date(endDateString);
        const attendanceRecords = await this.getAll('attendance');
        const allNonInstructional = await this.getAll('nonInstructionalDays');
        const nonInstructionalSet = new Set(allNonInstructional.map(d => d.date));

        // Get all holidays for the year
        const year = endDate.getFullYear();
        const holidays = this.getYukonHolidays(year);
        const holidaySet = new Set(holidays);

        let instructionalDaysChecked = 0;
        let currentDate = new Date(endDate);

        // Go backwards from the end date, checking up to 7 instructional days
        while (instructionalDaysChecked < 7) {
            const dateString = this.formatDateString(currentDate);
            
            // Skip if it's a weekend, holiday, or non-instructional day
            if (this.isWeekend(dateString) || holidaySet.has(dateString) || nonInstructionalSet.has(dateString)) {
                currentDate.setDate(currentDate.getDate() - 1);
                continue;
            }

            // This is an instructional day
            instructionalDaysChecked++;

            // Find attendance record for this date
            const record = attendanceRecords.find(a => a.studentId === studentId && a.date === dateString);
            
            // If present, return true
            if (record && record.status === 'present') {
                return true;
            }

            // Move to previous day
            currentDate.setDate(currentDate.getDate() - 1);

            // Safety limit: don't go back more than 30 days
            const daysBack = Math.floor((endDate - currentDate) / (1000 * 60 * 60 * 24));
            if (daysBack > 30) {
                break;
            }
        }

        return false;
    }

    // Format date as YYYY-MM-DD
    formatDateString(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // Get manual color indicator for a student
    async getManualColorIndicator(studentId) {
        try {
            const indicators = await this.getAll('attendanceColorIndicators');
            const activeIndicator = indicators.find(i => i.studentId === studentId && i.isActive !== false);
            return activeIndicator ? activeIndicator.color : null;
        } catch (e) {
            return null;
        }
    }

    // Get last day student was present
    async getLastDayAttended(studentId, endDateString) {
        const endDate = new Date(endDateString);
        const attendanceRecords = await this.getAll('attendance');
        const allNonInstructional = await this.getAll('nonInstructionalDays');
        const nonInstructionalSet = new Set(allNonInstructional.map(d => d.date));

        // Get all holidays for the year range we might check
        const year = endDate.getFullYear();
        const holidays = this.getYukonHolidays(year);
        const holidaySet = new Set(holidays);

        let currentDate = new Date(endDate);

        // Go backwards from the end date, checking up to 365 days
        const daysBackLimit = 365;
        let daysChecked = 0;

        while (daysChecked < daysBackLimit) {
            const dateString = this.formatDateString(currentDate);
            
            // Skip if it's a weekend, holiday, or non-instructional day
            if (this.isWeekend(dateString) || holidaySet.has(dateString) || nonInstructionalSet.has(dateString)) {
                currentDate.setDate(currentDate.getDate() - 1);
                daysChecked++;
                continue;
            }

            // Find attendance record for this date
            const record = attendanceRecords.find(a => a.studentId === studentId && a.date === dateString);
            
            // If present, return this date
            if (record && record.status === 'present') {
                return dateString;
            }

            // Move to previous day
            currentDate.setDate(currentDate.getDate() - 1);
            daysChecked++;
        }

        return null; // No attendance found
    }

    // Format date for display (e.g., "January 15, 2024")
    formatDateForDisplay(dateString) {
        if (!dateString) return 'Never';
        
        const parts = dateString.split('-');
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        const date = new Date(year, month, day);
        
        return date.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
    }

    // Show attendance color menu dropdown
    async showAttendanceColorMenu(studentId, consecutiveDays, currentColor, nameElement) {
        const student = await this.get('students', studentId);
        const studentName = student ? student.name : 'Student';
        const manualColor = await this.getManualColorIndicator(studentId);
        
        // Get current date from the date input
        const dateInput = document.getElementById('attendance-date');
        const currentDateString = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];
        
        // Get last day attended
        const lastDayAttended = await this.getLastDayAttended(studentId, currentDateString);
        const lastDayDisplay = this.formatDateForDisplay(lastDayAttended);
        
        // Get current teacher assignment
        const currentTeacher = await this.getTeacherTracking(studentId);

        // Remove any existing dropdown
        const existingDropdown = document.getElementById('attendance-color-dropdown');
        if (existingDropdown) {
            existingDropdown.remove();
        }

        // Create dropdown menu
        const dropdown = document.createElement('div');
        dropdown.id = 'attendance-color-dropdown';
        dropdown.className = 'attendance-color-dropdown';
        dropdown.style.position = 'absolute';
        dropdown.style.zIndex = '10000';
        
        const rect = nameElement.getBoundingClientRect();
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.top = `${rect.bottom + 5}px`;

        dropdown.innerHTML = `
            <div class="attendance-color-menu">
                <div class="attendance-color-menu-header">
                    <strong>${this.escapeHtml(studentName)}</strong>
                    <button class="attendance-color-close" onclick="this.closest('.attendance-color-dropdown').remove()">×</button>
                </div>
                <div class="attendance-color-menu-info">
                    <p><strong>Consecutive Absences:</strong> ${consecutiveDays} instructional days</p>
                    <p><strong>Last Day Attended:</strong> ${this.escapeHtml(lastDayDisplay)}</p>
                </div>
                <div class="attendance-color-menu-grad-list" style="margin-top: 10px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--text-color);">Teacher Tracking Student:</label>
                    <select id="teacher-tracking-${studentId}" class="form-control" style="font-size: 0.9rem; padding: 6px 8px;" onchange="tracker.saveTeacherTracking(${studentId})">
                        <option value="">None</option>
                        <option value="Maura" ${currentTeacher === 'Maura' ? 'selected' : ''}>Maura</option>
                        <option value="Bryan" ${currentTeacher === 'Bryan' ? 'selected' : ''}>Bryan</option>
                        <option value="Marie" ${currentTeacher === 'Marie' ? 'selected' : ''}>Marie</option>
                        <option value="Jud" ${currentTeacher === 'Jud' ? 'selected' : ''}>Jud</option>
                        <option value="Becca" ${currentTeacher === 'Becca' ? 'selected' : ''}>Becca</option>
                        <option value="Andrew" ${currentTeacher === 'Andrew' ? 'selected' : ''}>Andrew</option>
                        <option value="Meghan" ${currentTeacher === 'Meghan' ? 'selected' : ''}>Meghan</option>
                        <option value="Liard" ${currentTeacher === 'Liard' ? 'selected' : ''}>Liard</option>
                        <option value="Anya" ${currentTeacher === 'Anya' ? 'selected' : ''}>Anya</option>
                    </select>
                </div>
                <div class="attendance-color-menu-grad-list">
                    <label class="attendance-color-option" style="margin-bottom: 0;">
                        <input type="checkbox" id="grad-list-checkbox-${studentId}" ${student.onGradList ? 'checked' : ''} onchange="tracker.toggleGradList(${studentId})">
                        <span class="attendance-color-label">
                            <span style="font-size: 1.2rem; margin-right: 8px;">🎓</span>
                            <span><strong>Add to Grad List</strong></span>
                        </span>
                    </label>
                </div>
                <div class="attendance-color-menu-grad-list" style="margin-top: 10px;">
                    <label class="attendance-color-option" style="margin-bottom: 0;">
                        <input type="checkbox" id="graduated-checkbox-${studentId}" ${student.graduated ? 'checked' : ''} onchange="tracker.toggleGraduated(${studentId})">
                        <span class="attendance-color-label">
                            <span style="font-size: 1.2rem; margin-right: 8px;">🎉</span>
                            <span><strong>Graduated</strong></span>
                        </span>
                    </label>
                </div>
                <div class="attendance-color-menu-options">
                    <label class="attendance-color-option">
                        <input type="radio" name="color-${studentId}" value="auto" ${!manualColor ? 'checked' : ''}>
                        <span class="attendance-color-label">
                            <span class="attendance-color-box auto">Auto</span>
                            <span>Automatically track (Green/Yellow/Red)</span>
                        </span>
                    </label>
                    <label class="attendance-color-option">
                        <input type="radio" name="color-${studentId}" value="green" ${manualColor === 'green' ? 'checked' : ''}>
                        <span class="attendance-color-label">
                            <span class="attendance-color-box green"></span>
                            <span>Green</span>
                        </span>
                    </label>
                    <label class="attendance-color-option">
                        <input type="radio" name="color-${studentId}" value="yellow" ${manualColor === 'yellow' ? 'checked' : ''}>
                        <span class="attendance-color-label">
                            <span class="attendance-color-box yellow"></span>
                            <span>Yellow</span>
                        </span>
                    </label>
                    <label class="attendance-color-option">
                        <input type="radio" name="color-${studentId}" value="red" ${manualColor === 'red' ? 'checked' : ''}>
                        <span class="attendance-color-label">
                            <span class="attendance-color-box red"></span>
                            <span>Red</span>
                        </span>
                    </label>
                </div>
                <div class="attendance-color-menu-actions">
                    <button class="btn btn-primary" onclick="tracker.saveAttendanceColor(${studentId})">Save</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('attendance-color-dropdown').remove()">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(dropdown);

        // Close dropdown when clicking outside
        setTimeout(() => {
            const closeOnOutsideClick = (e) => {
                if (!dropdown.contains(e.target) && e.target !== nameElement) {
                    dropdown.remove();
                    document.removeEventListener('click', closeOnOutsideClick);
                }
            };
            document.addEventListener('click', closeOnOutsideClick);
        }, 100);
    }

    // Save attendance color indicator
    async saveAttendanceColor(studentId) {
        const radioButtons = document.querySelectorAll(`input[name="color-${studentId}"]`);
        let selectedColor = null;
        
        radioButtons.forEach(radio => {
            if (radio.checked) {
                if (radio.value === 'auto') {
                    selectedColor = null; // Auto tracking
                } else {
                    selectedColor = radio.value;
                }
            }
        });

        // Remove existing indicator
        const existingIndicators = await this.getAll('attendanceColorIndicators');
        const existing = existingIndicators.find(i => i.studentId === studentId && i.isActive !== false);
        
        if (existing) {
            if (selectedColor === null) {
                // Remove indicator (use auto)
                existing.isActive = false;
                existing.removedAt = new Date().toISOString();
                await this.update('attendanceColorIndicators', existing);
            } else {
                // Update color
                existing.color = selectedColor;
                existing.updatedAt = new Date().toISOString();
                await this.update('attendanceColorIndicators', existing);
            }
        } else if (selectedColor !== null) {
            // Add new indicator
            await this.add('attendanceColorIndicators', {
                studentId: studentId,
                color: selectedColor,
                isActive: true,
                createdAt: new Date().toISOString()
            });
        }

        // Remove dropdown
        const dropdown = document.getElementById('attendance-color-dropdown');
        if (dropdown) {
            dropdown.remove();
        }

        // Reload attendance to reflect the change
        await this.loadAttendanceForDate();
    }

    // Toggle grad list status for a student
    async toggleGradList(studentId) {
        const student = await this.get('students', studentId);
        if (!student) return;

        const checkbox = document.getElementById(`grad-list-checkbox-${studentId}`);
        const isOnGradList = checkbox ? checkbox.checked : false;

        student.onGradList = isOnGradList;
        await this.update('students', student);

        // Reload attendance to show/hide gold border
        await this.loadAttendanceForDate();
    }

    // Toggle graduated status for a student
    async toggleGraduated(studentId) {
        const student = await this.get('students', studentId);
        if (!student) return;

        const checkbox = document.getElementById(`graduated-checkbox-${studentId}`);
        const isGraduated = checkbox ? checkbox.checked : false;
        const wasAlreadyGraduated = student.graduated || false;

        student.graduated = isGraduated;
        
        // Track if this is the first time marking as graduated
        if (isGraduated && !wasAlreadyGraduated) {
            student.graduationAnimationShown = false;
        }
        
        await this.update('students', student);

        // Show celebration animation if this is the first time marking as graduated
        if (isGraduated && !wasAlreadyGraduated && !student.graduationAnimationShown) {
            this.showGraduationCelebration();
            student.graduationAnimationShown = true;
            await this.update('students', student);
        }

        // Reload attendance to show/hide gold color
        await this.loadAttendanceForDate();
    }

    // Render attendance notes for a student
    async renderAttendanceNotes(studentId) {
        const notes = await this.getAttendanceNotes(studentId);
        
        if (!notes || notes.entries.length === 0) {
            return `
                <div class="attendance-notes-display">
                    <button class="btn btn-secondary btn-sm" onclick="tracker.showNotesEditor(${studentId})" style="font-size: 0.85rem; padding: 6px 12px;">
                        📝 Add Note
                    </button>
                </div>
            `;
        }

        // Get the most recent note for preview
        const mostRecentNote = notes.entries[notes.entries.length - 1];
        const recentDate = new Date(mostRecentNote.date);
        const recentDateStr = recentDate.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric'
        });
        const previewText = mostRecentNote.text.length > 50 
            ? mostRecentNote.text.substring(0, 50) + '...' 
            : mostRecentNote.text;

        const notesHtml = notes.entries.map(entry => {
            const date = new Date(entry.date);
            const dateStr = date.toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            return `
                <div class="attendance-note-entry">
                    <div class="attendance-note-date">${this.escapeHtml(dateStr)}</div>
                    <div class="attendance-note-text">${this.escapeHtml(entry.text)}</div>
                </div>
            `;
        }).join('');

        return `
            <div class="attendance-notes-display">
                <div class="attendance-notes-collapsed" onclick="tracker.toggleNotesDisplay(${studentId})" style="cursor: pointer; padding: 8px; background: var(--bg-color); border-radius: 4px; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                    <div style="flex: 1;">
                        <div style="font-size: 0.85rem; font-weight: 600; color: var(--primary-color); margin-bottom: 4px;">
                            📝 ${notes.entries.length} note${notes.entries.length !== 1 ? 's' : ''}
                        </div>
                        <div style="font-size: 0.75rem; color: var(--secondary-color);">
                            Latest: ${this.escapeHtml(recentDateStr)} - ${this.escapeHtml(previewText)}
                        </div>
                    </div>
                    <span class="notes-toggle-icon" id="notes-toggle-${studentId}" style="font-size: 1.2rem; transition: transform 0.2s;">▼</span>
                </div>
                <div class="attendance-notes-expanded" id="notes-expanded-${studentId}" style="display: none; margin-top: 8px;">
                    <div class="attendance-notes-entries">${notesHtml}</div>
                    <div class="attendance-notes-actions">
                        <button class="btn btn-secondary btn-sm" onclick="tracker.showNotesEditor(${studentId})" style="font-size: 0.85rem; padding: 4px 8px; margin-top: 5px;">
                            ✏️ Edit
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // Toggle notes display (expand/collapse)
    toggleNotesDisplay(studentId) {
        const expandedDiv = document.getElementById(`notes-expanded-${studentId}`);
        const toggleIcon = document.getElementById(`notes-toggle-${studentId}`);
        
        if (expandedDiv && toggleIcon) {
            const isExpanded = expandedDiv.style.display !== 'none';
            expandedDiv.style.display = isExpanded ? 'none' : 'block';
            toggleIcon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
        }
    }

    // Get attendance notes for a student
    async getAttendanceNotes(studentId) {
        try {
            const allNotes = await this.getAll('attendanceNotes');
            const studentNotes = allNotes.find(n => n.studentId === studentId);
            return studentNotes || { studentId, entries: [] };
        } catch (e) {
            return { studentId, entries: [] };
        }
    }

    // Show notes editor modal
    async showNotesEditor(studentId) {
        const notes = await this.getAttendanceNotes(studentId);
        const student = await this.get('students', studentId);
        const studentName = student ? student.name : 'Student';

        // Remove any existing modal first
        const existingModal = document.getElementById('notes-editor-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'notes-editor-modal';
        modal.style.display = 'block';
        
        const notesDisplayHtml = notes.entries.length === 0 
            ? '<p style="color: var(--secondary-color); font-style: italic;">No notes yet.</p>'
            : notes.entries.map((entry, index) => {
                const date = new Date(entry.date);
                const dateStr = date.toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                return `<div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                    <div style="flex: 1;">
                        <strong style="color: var(--primary-color); font-size: 0.9rem;">${this.escapeHtml(dateStr)}:</strong>
                        <div style="margin-top: 5px;">${this.escapeHtml(entry.text)}</div>
                    </div>
                    <button class="btn btn-danger btn-sm" onclick="tracker.deleteAttendanceNote(${studentId}, ${index})" style="font-size: 0.75rem; padding: 4px 8px; flex-shrink: 0;" title="Delete this note">🗑️</button>
                </div>`;
            }).join('');
        
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 600px;">
                <span class="close" onclick="document.getElementById('notes-editor-modal').remove()">&times;</span>
                <h2>Narrative Notes: ${this.escapeHtml(studentName)}</h2>
                <div class="form-group">
                    <label>Current Notes:</label>
                    <div id="notes-display" style="max-height: 200px; overflow-y: auto; padding: 10px; background: var(--bg-color); border-radius: 6px; margin-bottom: 15px; border: 1px solid var(--border-color);">
                        ${notesDisplayHtml}
                    </div>
                </div>
                <div class="form-group">
                    <label for="new-note-text">Add New Note:</label>
                    <textarea id="new-note-text" class="form-control" rows="4" placeholder="Enter your note here..."></textarea>
                </div>
                <div class="form-actions">
                    <button class="btn btn-primary" onclick="tracker.saveAttendanceNote(${studentId}, false)">Add to Notes</button>
                    <button class="btn btn-danger" onclick="tracker.clearAttendanceNotes(${studentId})">Clear All Notes</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('notes-editor-modal').remove()">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        // Close modal when clicking the X button
        const closeBtn = modal.querySelector('.close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.remove();
            });
        }
    }

    // Save attendance note
    async saveAttendanceNote(studentId, clearFirst = false) {
        const textarea = document.getElementById('new-note-text');
        const noteText = textarea ? textarea.value.trim() : '';

        if (!noteText && !clearFirst) {
            alert('Please enter a note.');
            return;
        }

        const notes = await this.getAttendanceNotes(studentId);
        
        if (clearFirst) {
            notes.entries = [];
        } else if (noteText) {
            notes.entries.push({
                date: new Date().toISOString(),
                text: noteText
            });
        }

        // Save to database
        const existingNotes = await this.getAll('attendanceNotes');
        const existingNote = existingNotes.find(n => n.studentId === studentId);

        if (existingNote) {
            notes.id = existingNote.id;
            await this.update('attendanceNotes', notes);
        } else {
            await this.add('attendanceNotes', notes);
        }

        // Close modal
        const modal = document.getElementById('notes-editor-modal');
        if (modal) {
            modal.remove();
        }

        // Reload attendance to show updated notes
        await this.loadAttendanceForDate();
    }

    // Clear all attendance notes
    async clearAttendanceNotes(studentId) {
        if (!confirm('Are you sure you want to clear all notes for this student? This cannot be undone.')) {
            return;
        }

        await this.saveAttendanceNote(studentId, true);
    }

    // Delete a specific attendance note by index
    async deleteAttendanceNote(studentId, noteIndex) {
        if (!confirm('Are you sure you want to delete this note? This cannot be undone.')) {
            return;
        }

        const notes = await this.getAttendanceNotes(studentId);
        
        if (noteIndex >= 0 && noteIndex < notes.entries.length) {
            notes.entries.splice(noteIndex, 1);
        }

        // Save to database
        const existingNotes = await this.getAll('attendanceNotes');
        const existingNote = existingNotes.find(n => n.studentId === studentId);

        if (existingNote) {
            notes.id = existingNote.id;
            await this.update('attendanceNotes', notes);
        } else if (notes.entries.length > 0) {
            await this.add('attendanceNotes', notes);
        } else {
            // If no entries left, remove the note record entirely
            if (existingNote) {
                await this.delete('attendanceNotes', existingNote.id);
            }
        }

        // Reload the modal to show updated notes
        await this.showNotesEditor(studentId);
        
        // Also reload attendance to update notes display in the list
        await this.loadAttendanceForDate();
    }

    // Setup event listeners for attendance notes
    setupAttendanceNotesListeners() {
        // Event listeners are set up via onclick handlers in the HTML
        // This function is a placeholder for any additional setup needed
    }

    // Get teacher tracking for a student
    async getTeacherTracking(studentId) {
        try {
            const allTracking = await this.getAll('teacherTracking');
            const tracking = allTracking.find(t => t.studentId === studentId && t.isActive !== false);
            return tracking ? tracking.teacherName : null;
        } catch (e) {
            return null;
        }
    }

    // Save teacher tracking for a student
    async saveTeacherTracking(studentId) {
        const select = document.getElementById(`teacher-tracking-${studentId}`);
        if (!select) return;

        const teacherName = select.value.trim() || null;

        try {
            const allTracking = await this.getAll('teacherTracking');
            const existingTracking = allTracking.find(t => t.studentId === studentId && t.isActive !== false);

            if (teacherName) {
                // Save or update tracking
                if (existingTracking) {
                    existingTracking.teacherName = teacherName;
                    existingTracking.updatedAt = new Date().toISOString();
                    await this.update('teacherTracking', existingTracking);
                } else {
                    await this.add('teacherTracking', {
                        studentId: studentId,
                        teacherName: teacherName,
                        isActive: true,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    });
                }
            } else {
                // Remove tracking (set isActive to false)
                if (existingTracking) {
                    existingTracking.isActive = false;
                    existingTracking.updatedAt = new Date().toISOString();
                    await this.update('teacherTracking', existingTracking);
                }
            }

            // Reload attendance to show updated teacher name
            await this.loadAttendanceForDate();
        } catch (e) {
            console.error('Error saving teacher tracking:', e);
            alert('Error saving teacher assignment. Please try again.');
        }
    }

    // Calculate consecutive absences (only counting instructional days)
    async calculateConsecutiveAbsences(studentId, endDateString) {
        const endDate = new Date(endDateString);
        const attendanceRecords = await this.getAll('attendance');
        const allNonInstructional = await this.getAll('nonInstructionalDays');
        const nonInstructionalSet = new Set(allNonInstructional.map(d => d.date));

        // Get all holidays for the year range we might check
        const year = endDate.getFullYear();
        const holidays = this.getYukonHolidays(year);
        const holidaySet = new Set(holidays);

        let consecutiveDays = 0;
        let currentDate = new Date(endDate);

        // Go backwards from the end date
        while (true) {
            const dateString = this.formatDateString(currentDate);
            
            // Skip if it's a weekend, holiday, or non-instructional day
            if (this.isWeekend(dateString) || holidaySet.has(dateString) || nonInstructionalSet.has(dateString)) {
                currentDate.setDate(currentDate.getDate() - 1);
                continue;
            }

            // Find attendance record for this date
            const record = attendanceRecords.find(a => a.studentId === studentId && a.date === dateString);
            
            // If present, stop counting
            if (record && record.status === 'present') {
                break;
            }

            // If absent or no record (defaults to absent), increment counter
            consecutiveDays++;

            // Move to previous day
            currentDate.setDate(currentDate.getDate() - 1);

            // Safety limit: don't go back more than 365 days
            const daysBack = Math.floor((endDate - currentDate) / (1000 * 60 * 60 * 24));
            if (daysBack > 365) {
                break;
            }
        }

        return consecutiveDays;
    }

    // Update attendance status for a student
    async updateAttendanceStatus(studentId, dateString, status) {
        const attendanceRecords = await this.getAll('attendance');
        const existing = attendanceRecords.find(a => a.studentId === studentId && a.date === dateString);

        const record = {
            studentId: studentId,
            date: dateString,
            status: status,
            updatedAt: new Date().toISOString()
        };

        if (existing) {
            record.id = existing.id;
            await this.update('attendance', record);
        } else {
            await this.add('attendance', record);
        }

        // Update the status text
        const row = document.querySelector(`.attendance-row[data-student-id="${studentId}"]`);
        if (row) {
            const statusText = row.querySelector('.attendance-status-text');
            if (statusText) {
                statusText.textContent = status === 'present' ? 'Present' : 'Absent';
            }
        }
    }

    // Mark all students as present or absent
    async markAllAttendance(isPresent) {
        const dateInput = document.getElementById('attendance-date');
        if (!dateInput || !dateInput.value) {
            alert('Please select a date first.');
            return;
        }

        const dateString = dateInput.value;
        const isNonInstructional = await this.isNonInstructionalDay(dateString);
        const isHoliday = await this.isYukonHoliday(dateString);
        const isWeekendDay = this.isWeekend(dateString);

        if (isNonInstructional || isHoliday || isWeekendDay) {
            alert('Cannot record attendance on non-instructional days, holidays, or weekends.');
            return;
        }

        const students = await this.getAll('students');
        const status = isPresent ? 'present' : 'absent';

        for (const student of students) {
            await this.updateAttendanceStatus(student.id, dateString, status);
        }

        // Reload attendance display
        await this.loadAttendanceForDate();
    }

    // Save attendance for the current date
    async saveAttendance() {
        const dateInput = document.getElementById('attendance-date');
        if (!dateInput || !dateInput.value) {
            alert('Please select a date first.');
            return;
        }

        const dateString = dateInput.value;
        const isNonInstructional = await this.isNonInstructionalDay(dateString);
        const isHoliday = await this.isYukonHoliday(dateString);
        const isWeekendDay = this.isWeekend(dateString);

        if (isNonInstructional || isHoliday || isWeekendDay) {
            alert('Cannot save attendance on non-instructional days, holidays, or weekends.');
            return;
        }

        const checkboxes = document.querySelectorAll('.attendance-checkbox:not(:disabled)');
        let savedCount = 0;

        for (const checkbox of checkboxes) {
            const studentId = parseInt(checkbox.dataset.studentId);
            const status = checkbox.checked ? 'present' : 'absent';
            await this.updateAttendanceStatus(studentId, dateString, status);
            savedCount++;
        }

        // Update original state and clear unsaved changes flag
        this.attendanceOriginalState.clear();
        checkboxes.forEach(checkbox => {
            const studentId = parseInt(checkbox.dataset.studentId);
            const status = checkbox.checked ? 'present' : 'absent';
            this.attendanceOriginalState.set(studentId, status);
        });
        this.attendanceHasUnsavedChanges = false;

        if (savedCount > 0) {
            alert(`Attendance saved for ${savedCount} student(s)!`);
        } else {
            alert('No attendance data to save.');
        }
    }

    async checkUnsavedAttendanceChanges(onContinue) {
        if (this.attendanceHasUnsavedChanges) {
            const result = await this.showSaveAttendanceReminder();
            if (result === 'save') {
                await this.saveAttendance();
                // Wait a moment for save to complete
                await new Promise(resolve => setTimeout(resolve, 100));
                if (onContinue) await onContinue();
            } else if (result === 'discard') {
                this.attendanceHasUnsavedChanges = false;
                if (onContinue) await onContinue();
            }
            // If result is 'cancel', do nothing (don't change date)
        } else {
            if (onContinue) await onContinue();
        }
    }

    showSaveAttendanceReminder() {
        return new Promise((resolve) => {
            // Remove any existing reminder modal
            const existingModal = document.getElementById('attendance-save-reminder-modal');
            if (existingModal) {
                existingModal.remove();
            }

            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'attendance-save-reminder-modal';
            modal.style.display = 'block';

            modal.innerHTML = `
                <div class="modal-content" style="max-width: 500px;">
                    <h2>⚠️ Unsaved Attendance Changes</h2>
                    <p>You have unsaved attendance changes. What would you like to do?</p>
                    <div class="form-actions" style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
                        <button class="btn btn-primary" id="save-and-continue-btn">💾 Save & Continue</button>
                        <button class="btn btn-secondary" id="discard-and-continue-btn">❌ Discard & Continue</button>
                        <button class="btn btn-secondary" id="cancel-date-change-btn">Cancel</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Event listeners
            document.getElementById('save-and-continue-btn').addEventListener('click', () => {
                modal.remove();
                resolve('save');
            });

            document.getElementById('discard-and-continue-btn').addEventListener('click', () => {
                modal.remove();
                resolve('discard');
            });

            document.getElementById('cancel-date-change-btn').addEventListener('click', () => {
                modal.remove();
                resolve('cancel');
            });

            // Close on backdrop click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                    resolve('cancel');
                }
            });
        });
    }

    closeModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatNameForReport(name) {
        if (!name) return '';
        // Convert "Last, First" to "First Last"
        const commaIndex = name.indexOf(',');
        if (commaIndex > 0) {
            const last = name.substring(0, commaIndex).trim();
            const first = name.substring(commaIndex + 1).trim();
            return first && last ? `${first} ${last}` : name;
        }
        // If no comma, assume it's already "First Last" format
        return name;
    }
    
    escapeCssString(str) {
        if (!str) return '';
        // Escape quotes and backslashes for CSS content
        return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");
    }
    
    getLetterGrade(numericGrade) {
        if (!numericGrade) return '';
        
        // Extract number from grade string (handle formats like "86", "86%", "A 86", etc.)
        const numMatch = String(numericGrade).match(/(\d+(?:\.\d+)?)/);
        if (!numMatch) return '';
        
        const num = parseFloat(numMatch[1]);
        if (isNaN(num)) return '';
        
        // Convert to letter grade based on proficiency scale
        if (num >= 86) return 'A';
        if (num >= 73) return 'B';
        if (num >= 67) return 'C+';
        if (num >= 60) return 'C';
        if (num >= 50) return 'C-';
        return 'F';
    }
    
    formatGradeForReport(gradeText) {
        if (!gradeText) return '';
        
        // Extract number from grade string
        const numMatch = String(gradeText).match(/(\d+(?:\.\d+)?)/);
        if (!numMatch) return gradeText; // Return original if no number found
        
        const num = parseFloat(numMatch[1]);
        if (isNaN(num)) return gradeText;
        
        const letterGrade = this.getLetterGrade(num);
        return `${Math.round(num)}% (${letterGrade})`;
    }

    formatDate(dateString) {
        if (!dateString) return '';
        try {
            const date = new Date(dateString);
            // Format as YYYY-MM-DD or a more readable format
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        } catch (e) {
            return dateString;
        }
    }
}

// Initialize the application
const tracker = new CompetencyTracker();

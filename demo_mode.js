(function () {
    // Demo helper: deterministically replace student/teacher names,
    // translate subjects to English, set two funny messages of day,
    // replace homeworks with silly English tasks, and set holiday to Saturday.
    const mapSubjects = {
        Mathematik: 'Mathematics',
        Mathe: 'Mathematics',
        Englisch: 'English',
        Deutsch: 'German',
        Biologie: 'Biology',
        Chemie: 'Chemistry',
        Physik: 'Physics',
        Sport: 'Physical Education',
        Geschichte: 'History',
        Erdkunde: 'Geography',
        Informatik: 'Computer Science',
        Musik: 'Music',
        Kunst: 'Art',
    };

    function translateSubject(name) {
        if (!name) return name;
        for (const g in mapSubjects) {
            if (Object.prototype.hasOwnProperty.call(mapSubjects, g)) {
                if (String(name).toLowerCase().includes(g.toLowerCase())) return mapSubjects[g];
            }
        }

        // Fallback: map unknown abbreviations/id strings deterministically to a list
        const englishFallback = [
            'Mathematics',
            'English',
            'German',
            'Biology',
            'Chemistry',
            'Physics',
            'Physical Education',
            'History',
            'Geography',
            'Computer Science',
            'Music',
            'Art',
            'Economics',
            'Philosophy',
            'Drama',
            'Statistics',
        ];
        const idx = stableHash(String(name)) % englishFallback.length;
        return englishFallback[idx];
    }

    const studentNames = [
        'Lukas',
        'Maya',
        'Jonah',
        'Zoe',
        'Nico',
        'Lena',
        'Tom',
        'Mia',
        'Finn',
        'Emilia',
    ];

    const teacherNames = [
        'Mr. Pickles',
        'Ms. Fizzle',
        'Dr. Quirk',
        'Prof. Snickerdoodle',
        'Mrs. Bumble',
        'Mr. Wobble',
        'Ms. Glitter',
    ];

    function stableHash(str) {
        let h = 2166136261 >>> 0;
        const s = String(str || '');
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return h;
    }

    function mapStudentName(orig, module) {
        module.__demoOriginalMap = module.__demoOriginalMap || {};
        if (module.__demoOriginalMap[orig]) return module.__demoOriginalMap[orig];
        const idx = stableHash(orig) % studentNames.length;
        const mapped = `${studentNames[idx]}`;
        module.__demoOriginalMap[orig] = mapped;
        return mapped;
    }

    function mapTeacherName(orig, module) {
        module.__demoTeacherMap = module.__demoTeacherMap || {};
        // if already mapped from original -> mapped, return it
        if (module.__demoTeacherMap[orig]) return module.__demoTeacherMap[orig];
        // avoid double-mapping: if orig already looks like a mapped name, skip
        const mappedSet = new Set(Object.values(module.__demoTeacherMap || {}));
        if (mappedSet.has(orig)) return orig;
        const idx = stableHash(orig) % teacherNames.length;
        const mapped = teacherNames[idx];
        module.__demoTeacherMap[orig] = mapped;
        return mapped;
    }

    function cloneArray(arr) {
        return Array.isArray(arr) ? JSON.parse(JSON.stringify(arr)) : arr;
    }

    // applyDemo(module, studentTitle?)
    // If studentTitle is provided, only apply transformations for that student (idempotent per student).
    function applyDemo(module, studentTitle) {
        if (!module) return;
        module.__demoAppliedPerStudent = module.__demoAppliedPerStudent || {};
        // if a specific student is requested and already applied, skip
        if (studentTitle && module.__demoAppliedPerStudent[studentTitle]) return;
        // if no student specified and global flag set, skip
        if (!studentTitle && module.__demoApplied) return;

        try {
            const students = studentTitle ? [studentTitle] : Object.keys(module.timetableByStudent || {});

            for (const st of students) {
                if (!st) continue;
                if (module.__demoAppliedPerStudent[st]) continue;

                // lessons: translate subject names and remap teachers
                const lessons = module.timetableByStudent[st] || [];
                for (const le of lessons) {
                    if (Array.isArray(le.su) && le.su[0]) {
                        if (le.su[0].longname) le.su[0].longname = translateSubject(le.su[0].longname);
                        if (le.su[0].name) le.su[0].name = translateSubject(le.su[0].name);
                    }
                    if (Array.isArray(le.te)) {
                        for (let i = 0; i < le.te.length; i++) {
                            const orig = le.te[i] && (le.te[i].longname || le.te[i].name) ? (le.te[i].longname || le.te[i].name) : `teacher_${i}`;
                            const mapped = mapTeacherName(orig, module);
                            if (le.te[i]) {
                                le.te[i].longname = mapped;
                                le.te[i].name = mapped;
                            }
                        }
                    }
                }

                // exams
                const exams = module.examsByStudent[st] || [];
                for (const ex of exams) {
                    if (ex.subject) ex.subject = translateSubject(ex.subject);
                    if (Array.isArray(ex.teachers) && ex.teachers.length > 0) {
                        ex.teachers = ex.teachers.map((t) => mapTeacherName(t || 'examTeacher', module));
                    }
                    if (ex.name) ex.name = `Demo ${ex.name}`;
                }

                // homeworks: replace with silly tasks and set due date to next Monday
                const now2 = new Date();
                const daysUntilMon = (1 - now2.getDay() + 7) % 7 || 7;
                const mon = new Date(now2.getFullYear(), now2.getMonth(), now2.getDate() + daysUntilMon);
                const monYmd = mon.getFullYear() * 10000 + (mon.getMonth() + 1) * 100 + mon.getDate();
                module.homeworksByStudent[st] = [
                    { dueDate: monYmd, su: { name: 'English', longname: 'English' }, text: "Write a 500-word essay about why spoons are superior to forks." },
                    { dueDate: monYmd, su: { name: 'Creative Writing', longname: 'Creative Writing' }, text: "Invent a new word and use it in 10 sentences." },
                ];

                // messages of day: ensure objects with subject/text
                module.messagesOfDayByStudent = module.messagesOfDayByStudent || {};
                module.messagesOfDayByStudent[st] = [
                    { subject: 'Note', text: "Don't forget: socks are optional on Tuesdays!" },
                    { subject: 'Reminder', text: 'Talk to your plants; they miss you.' },
                ];

                // absences: replace reasons
                const abs = module.absencesByStudent[st] || [];
                for (const ab of abs) {
                    if (ab.reason) ab.reason = 'Demo: off to chase butterflies';
                }

                // holiday: next Saturday with creative name
                const now = new Date();
                const daysUntilSat = (6 - now.getDay() + 7) % 7;
                const sat = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilSat);
                const satYmd = sat.getFullYear() * 10000 + (sat.getMonth() + 1) * 100 + sat.getDate();
                module.holidaysByStudent = module.holidaysByStudent || {};
                module.holidaysByStudent[st] = [{ startDate: satYmd, endDate: satYmd, name: 'Samtastisch', longName: 'Samtastisch - Super Relax Day' }];

                // refresh preprocessed grouped map so grid uses updated lessons
                try {
                    const grouped = {};
                    const lessonsForStudent = module.timetableByStudent[st] || [];
                    (lessonsForStudent || []).forEach((el) => {
                        const key = el && el.date != null ? String(el.date) : null;
                        if (!key) return;
                        if (!grouped[key]) grouped[key] = [];
                        grouped[key].push(el);
                    });
                    Object.keys(grouped).forEach((k) => grouped[k].sort((a, b) => (a.startTime || 0) - (b.startTime || 0)));
                    module.preprocessedByStudent = module.preprocessedByStudent || {};
                    module.preprocessedByStudent[st] = { ...(module.preprocessedByStudent[st] || {}), rawGroupedByDate: grouped };
                } catch (e) {
                    // ignore
                }

                // mark this student as processed
                module.__demoAppliedPerStudent[st] = true;
            }

            if (!studentTitle) module.__demoApplied = true;

            try {
                if (typeof module.updateDom === 'function') module.updateDom();
            } catch (e) {
                // ignore
            }
        } catch (e) {
            // swallow errors in demo helper
            // eslint-disable-next-line no-console
            console.error('[MMM-Webuntis] demo apply error', e);
        }
    }

    window.MMMWebuntisDemo = {
        applyDemo,
    };
})();

(function () {
    // Transform an incoming payload (from node_helper) for demoMode on frontend.
    // Returns a new payload (shallow clone) or the original if not modified.
    function transformPayload(payload, title) {
        try {
            if (!payload || payload.__demoTransformed) return payload;
            const out = JSON.parse(JSON.stringify(payload));

            const makeYmd = (d) => {
                if (!d) return d;
                const n = Number(d);
                if (Number.isFinite(n) && n > 0) return n;
                const dt = new Date(String(d));
                if (Number.isNaN(dt.getTime())) return d;
                return dt.getFullYear() * 10000 + (dt.getMonth() + 1) * 100 + dt.getDate();
            };

            // helper similar to applyDemo but works on payload objects
            const mapSubjectsLocal = (su) => {
                if (!su) return su;
                if (Array.isArray(su) && su[0]) {
                    if (su[0].longname) su[0].longname = translateSubject(su[0].longname);
                    if (su[0].name) su[0].name = translateSubject(su[0].name);
                } else if (su.name || su.longname) {
                    if (su.longname) su.longname = translateSubject(su.longname);
                    if (su.name) su.name = translateSubject(su.name);
                }
                return su;
            };

            const mapTeachersLocal = (teArray) => {
                if (!Array.isArray(teArray)) return teArray;
                return teArray.map((t) => mapTeacherName(t || 'teacher', window.MMMWebuntisDemo));
            };

            // timetableRange -> translate subjects and teachers
            if (Array.isArray(out.timetableRange)) {
                out.timetableRange.forEach((entry) => {
                    if (entry && entry.su) entry.su = mapSubjectsLocal(entry.su);
                    if (entry && entry.te) entry.te = entry.te.map((t) => ({ name: mapTeacherName(t.name || t.longname || t || 'teacher', window.MMMWebuntisDemo), longname: mapTeacherName(t.name || t.longname || t || 'teacher', window.MMMWebuntisDemo) }));
                });
            }

            // exams
            if (Array.isArray(out.exams)) {
                out.exams.forEach((ex) => {
                    if (ex.subject) ex.subject = translateSubject(ex.subject);
                    if (Array.isArray(ex.teachers)) ex.teachers = ex.teachers.map((t) => mapTeacherName(t || 'examTeacher', window.MMMWebuntisDemo));
                    if (ex.name) ex.name = `Demo ${ex.name}`;
                });
            }

            // homeworks -> replace with silly demo HW (with dueDate)
            const now2 = new Date();
            const daysUntilMon = (1 - now2.getDay() + 7) % 7 || 7;
            const mon = new Date(now2.getFullYear(), now2.getMonth(), now2.getDate() + daysUntilMon);
            const monYmd = mon.getFullYear() * 10000 + (mon.getMonth() + 1) * 100 + mon.getDate();
            out.homeworks = [
                { dueDate: monYmd, su: { name: 'English', longname: 'English' }, text: "Write a 500-word essay about why spoons are superior to forks." },
                { dueDate: monYmd, su: { name: 'Creative Writing', longname: 'Creative Writing' }, text: "Invent a new word and use it in 10 sentences." },
            ];

            // absences
            if (Array.isArray(out.absences)) {
                out.absences.forEach((ab) => {
                    if (ab.reason) ab.reason = 'Demo: off to chase butterflies';
                });
            }

            // messagesOfDay
            out.messagesOfDay = [
                { subject: 'Note', text: "Don't forget: socks are optional on Tuesdays!" },
                { subject: 'Reminder', text: 'Talk to your plants; they miss you.' },
            ];

            // holidays -> set Saturday creative name
            const now = new Date();
            const daysUntilSat = (6 - now.getDay() + 7) % 7;
            const sat = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilSat);
            const satYmd = sat.getFullYear() * 10000 + (sat.getMonth() + 1) * 100 + sat.getDate();
            out.holidays = [{ startDate: satYmd, endDate: satYmd, name: 'Samtastisch', longName: 'Samtastisch - Super Relax Day' }];
            // Inject one exam for the next day so the grid shows an exam overlay for a lesson
            try {
                if (!out.__demoExamInjected) {
                    const nowEx = new Date();
                    const tom = new Date(nowEx.getFullYear(), nowEx.getMonth(), nowEx.getDate() + 1);
                    const tomYmd = tom.getFullYear() * 10000 + (tom.getMonth() + 1) * 100 + tom.getDate();
                    let chosenStart = null;
                    let chosenSubject = 'Klausur';
                    if (Array.isArray(out.timetableRange) && out.timetableRange.length > 0) {
                        // pick first lesson and reuse its startTime/subject
                        const first = out.timetableRange.find((e) => e && e.startTime !== undefined) || out.timetableRange[0];
                        if (first) {
                            chosenStart = first.startTime || first.startTime;
                            if (first.su && Array.isArray(first.su) && first.su[0]) {
                                chosenSubject = first.su[0].name || first.su[0].longname || chosenSubject;
                            } else if (first.su && (first.su.name || first.su.longname)) {
                                chosenSubject = first.su.name || first.su.longname || chosenSubject;
                            }
                        }
                    }
                    const chosenTeacherFromFirst = (first && first.te && Array.isArray(first.te) && (first.te[0].name || first.te[0].longname))
                        ? (first.te[0].name || first.te[0].longname)
                        : null;
                    const exam = {
                        examDate: tomYmd,
                        startTime: chosenStart || '0800',
                        subject: chosenSubject,
                        name: chosenSubject ? `${chosenSubject} Exam` : 'Exam',
                        teachers: [chosenTeacherFromFirst || 'Examiner'],
                    };
                    out.exams = Array.isArray(out.exams) ? out.exams.concat([exam]) : [exam];
                    out.__demoExamInjected = true;
                }
            } catch (e) {
                // ignore
            }

            out.__demoTransformed = true;
            return out;
        } catch (e) {
            // on error, return original
            return payload;
        }
    }

    // expose transformPayload
    if (window.MMMWebuntisDemo) window.MMMWebuntisDemo.transformPayload = transformPayload;
})();


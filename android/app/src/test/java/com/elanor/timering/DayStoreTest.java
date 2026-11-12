package com.elanor.timering;

import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import static org.junit.Assert.*;

public class DayStoreTest {
    @Rule public TemporaryFolder folder = new TemporaryFolder();

    @Test public void dataSurvivesReopeningAndKeepsOverlappingUnicodeEvents() throws Exception {
        DayStore store = new DayStore(folder.getRoot().toPath());
        String json = "[{\"start\":\"09:00\",\"end\":\"11:00\",\"label\":\"读书📚\"},{\"start\":\"10:00\",\"end\":\"12:00\",\"label\":\"音乐\"}]";
        store.write("2026-11-12", json);
        assertEquals(json, new DayStore(folder.getRoot().toPath()).read("2026-11-12"));
        store.write("2026-11-12", "[]");
        assertEquals("[]", store.read("2026-11-12"));
    }

    @Test public void historyIsSortedAndIgnoresTemporaryFiles() throws Exception {
        DayStore store = new DayStore(folder.getRoot().toPath());
        assertNull(store.read("2026-11-10"));
        store.write("2026-11-10", "[]");
        store.write("2026-11-12", "[]");
        Files.write(folder.getRoot().toPath().resolve("2026-11-11.tmp"), "partial".getBytes(StandardCharsets.UTF_8));
        assertEquals(Arrays.asList("2026-11-12", "2026-11-10"), store.list());
    }

    @Test public void invalidDatesAndPathTraversalCannotWrite() throws Exception {
        DayStore store = new DayStore(folder.getRoot().toPath());
        for (String date : new String[] {"../outside", "2026-02-30", "2026-1-1"}) {
            try { store.write(date, "[]"); fail("Date must be rejected: " + date); }
            catch (RuntimeException expected) { }
        }
        assertEquals(0, store.list().size());
    }
}

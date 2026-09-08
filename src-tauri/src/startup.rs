use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Mutex, time::Instant};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Milestone {
    Setup,
    Frontend,
    RepositoryDiscovery,
    RepositorySnapshot,
    RepositoryWatch,
    Repository,
    Welcome,
}

pub struct Startup {
    entered: Instant,
    milestones: Mutex<BTreeMap<Milestone, f64>>,
}

impl Startup {
    pub fn new() -> Self {
        Self {
            entered: Instant::now(),
            milestones: Mutex::new(BTreeMap::new()),
        }
    }

    pub fn record(&self, phase: Milestone) -> Result<BTreeMap<Milestone, f64>, String> {
        let mut milestones = self.milestones.lock().map_err(|error| error.to_string())?;
        if !matches!(phase, Milestone::Setup | Milestone::Frontend)
            && (milestones.contains_key(&Milestone::Repository)
                || milestones.contains_key(&Milestone::Welcome))
        {
            return Ok(milestones.clone());
        }
        milestones
            .entry(phase)
            .or_insert_with(|| self.entered.elapsed().as_secs_f64() * 1000.0);
        Ok(milestones.clone())
    }
}

#[tauri::command]
pub fn startup_milestone(
    phase: Milestone,
    state: tauri::State<'_, Startup>,
) -> Result<BTreeMap<Milestone, f64>, String> {
    state.record(phase)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn milestones_are_monotonic_and_recorded_only_once() {
        let startup = Startup::new();
        let first = startup.record(Milestone::Frontend).unwrap();
        assert!(first[&Milestone::Frontend] >= 0.0);
        let ready = startup.record(Milestone::Repository).unwrap();
        assert!(ready[&Milestone::Repository] >= first[&Milestone::Frontend]);
        assert_eq!(startup.record(Milestone::Frontend).unwrap(), ready);
        assert_eq!(startup.record(Milestone::Welcome).unwrap(), ready);
        let json = serde_json::to_value(ready).unwrap();
        assert_eq!(json.as_object().unwrap().len(), 2);
        assert!(json["frontend"].is_number());
        assert!(json["repository"].is_number());
    }
}
